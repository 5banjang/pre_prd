// PRD 실시간 미리보기 — FR-006 + 섹션 직접 편집 FR-007.
//
// 상태 표시: ● confirmed / ◐ drafting / ○ empty (스펙 §10)

import { useEffect, useRef, useState } from 'react';
import {
  SECTION_DEFS, SECTION_IDS, STATUS_LABEL,
  type PRDState, type Section, type SectionId,
} from '../types/prd.js';

/** 어느 섹션을 지목했는가 + 몇 번째 지목인가. nonce가 없으면 같은 섹션 재클릭이 무시된다. */
export type SectionFocus = { id: SectionId; nonce: number } | null;

interface Props {
  state: PRDState;
  onEdit: (id: SectionId, content: string) => void;
  onUnlock: (id: SectionId) => void;
  /** 점검 화면에서 [지금 작성]을 누른 섹션 — 펼치고 스크롤한다 (FR-005 개정) */
  focus?: SectionFocus;
}

const MARK: Record<Section['status'], string> = {
  confirmed: '●',
  drafting: '◐',
  empty: '○',
};

function SectionRow(
  { s, onEdit, onUnlock, focused, nonce }:
  { s: Section; focused: boolean; nonce: number } & Omit<Props, 'state' | 'focus'>,
) {
  const [open, setOpen] = useState(s.status !== 'empty');
  const box = useRef<HTMLDivElement>(null);

  // 점검 화면에서 지목되면 펼치고 화면에 들여온다.
  useEffect(() => {
    if (!focused) return;
    setOpen(true);
    box.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focused, nonce]);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(s.content);

  function startEdit() {
    setDraft(s.content);
    setEditing(true);
    setOpen(true);
  }

  function save() {
    onEdit(s.id, draft);
    setEditing(false);
  }

  return (
    <div className={`section ${s.status}${focused ? ' focused' : ''}`} ref={box} id={`sec-${s.id}`}>
      {/* 헤더 클릭 시 접기/펴기 — FR-006 AC3 */}
      <button className="section-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`mark ${s.status}`} title={STATUS_LABEL[s.status]}>{MARK[s.status]}</span>
        <span className="stitle">{SECTION_DEFS[s.id].label}</span>
        <span className="sid" title={`문서상 항목 번호 · ${s.title}`}>{s.id}</span>
        {s.locked && <span className="lock" title="직접 편집한 섹션입니다">🔒</span>}
        {!s.required && (
          <span className="cond" title="해당될 때만 필요합니다">해당 시</span>
        )}
        <span className="chars">{s.content.length > 0 ? `${s.content.length}자` : ''}</span>
      </button>

      {open && (
        <div className="section-body">
          {editing ? (
            <>
              <textarea value={draft} rows={12} onChange={(e) => setDraft(e.target.value)} />
              <div className="row">
                <button onClick={save}>저장</button>
                <button className="ghost" onClick={() => setEditing(false)}>취소</button>
              </div>
            </>
          ) : (
            <>
              {s.content
                ? <pre className="md">{s.content}</pre>
                : (
                  <p className="section-hint">
                    <strong>아직 비어 있습니다.</strong> {SECTION_DEFS[s.id].hint}
                  </p>
                )}
              <div className="row">
                <button className="ghost" onClick={startEdit}>직접 편집</button>
                {s.locked && (
                  <button className="ghost" onClick={() => onUnlock(s.id)}>
                    잠금 해제
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function PreviewPanel({ state, onEdit, onUnlock, focus = null }: Props) {
  const frs = state.requirements.filter((r) => r.section === 'FR').length;
  const nfrs = state.requirements.length - frs;

  return (
    <section className="preview">
      <div className="preview-head">
        <h2>PRD 미리보기</h2>
        <div className="counts">
          <span title="앱이 해야 하는 일">기능 {frs}</span>
          {' · '}
          <span title="보안·성능 등 기능이 아닌 조건">품질 {nfrs}</span>
          {' · '}
          <span title="아직 못 정한 것">미해결 {state.openQuestions.length}</span>
          {state.unverifiedTerms.length > 0 && (
            <span title="확인되지 않은 서비스명·가격·수치">
              {' · '}미검증 {state.unverifiedTerms.length}
            </span>
          )}
        </div>
      </div>

      <div className="sections">
        {SECTION_IDS.map((id) => (
          <SectionRow
            key={id}
            s={state.sections[id]}
            onEdit={onEdit}
            onUnlock={onUnlock}
            focused={focus?.id === id}
            nonce={focus?.nonce ?? 0}
          />
        ))}
      </div>
    </section>
  );
}
