// PRD 실시간 미리보기 — FR-006 + 섹션 직접 편집 FR-007.
//
// 상태 표시: ● confirmed / ◐ drafting / ○ empty (스펙 §10)

import { useState } from 'react';
import { SECTION_IDS, type PRDState, type Section, type SectionId } from '../types/prd.js';

interface Props {
  state: PRDState;
  onEdit: (id: SectionId, content: string) => void;
  onUnlock: (id: SectionId) => void;
}

const MARK: Record<Section['status'], string> = {
  confirmed: '●',
  drafting: '◐',
  empty: '○',
};

function SectionRow({ s, onEdit, onUnlock }: { s: Section } & Omit<Props, 'state'>) {
  const [open, setOpen] = useState(s.status !== 'empty');
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
    <div className={`section ${s.status}`}>
      {/* 헤더 클릭 시 접기/펴기 — FR-006 AC3 */}
      <button className="section-head" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        <span className={`mark ${s.status}`}>{MARK[s.status]}</span>
        <span className="sid">{s.id}</span>
        <span className="stitle">{s.title}</span>
        {s.locked && <span className="lock" title="직접 편집한 섹션입니다">🔒</span>}
        {!s.required && <span className="cond" title="조건부 필수">조건부</span>}
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
              <pre className="md">{s.content || '아직 비어 있습니다.'}</pre>
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

export function PreviewPanel({ state, onEdit, onUnlock }: Props) {
  const frs = state.requirements.filter((r) => r.section === 'FR').length;
  const nfrs = state.requirements.length - frs;

  return (
    <section className="preview">
      <div className="preview-head">
        <h2>PRD 미리보기</h2>
        <div className="counts">
          FR {frs} · NFR {nfrs} · 질문 {state.openQuestions.length}
          {state.unverifiedTerms.length > 0 && ` · [미검증] ${state.unverifiedTerms.length}`}
        </div>
      </div>

      <div className="sections">
        {SECTION_IDS.map((id) => (
          <SectionRow key={id} s={state.sections[id]} onEdit={onEdit} onUnlock={onUnlock} />
        ))}
      </div>
    </section>
  );
}
