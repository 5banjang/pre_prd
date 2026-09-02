// 내보내기 — FR-008 개정 (개정안 #02 §B4).
//
// 산출물을 **읽는 주체별로** 나눠 보여주고 필요한 것만 고르게 한다.
// 기본 선택은 사람용 2종 + 상태 JSON. 나머지는 개발 AI에게 넘길 때 켠다.

import { useState } from 'react';
import type { PRDState } from '../types/prd.js';
import type { ValidationIssue } from '../validator/validate.js';
import {
  ARTIFACTS, DEFAULT_SELECTION, byId, downloadBundle, downloadOne, renderOne,
  type ArtifactId,
} from '../export/artifacts.js';

interface Props {
  state: PRDState;
  issues: readonly ValidationIssue[];
  /**
   * 산출물을 실제로 받아갔을 때 한 번 불린다 — 판본을 찍는 신호다 (FR-016 / §B2 AC3).
   * 미리보기만 열어본 것은 "받았다"가 아니므로 부르지 않는다.
   */
  onTake?: () => void;
}

const GROUPS: { audience: 'human' | 'ai'; title: string; note: string }[] = [
  { audience: 'human', title: '사람이 읽는 문서', note: '브라우저에서 열리고 인쇄된다' },
  { audience: 'ai', title: '개발 AI가 읽는 것', note: '그대로 저장소에 넣는다' },
];

export function ExportBar({ state, issues, onTake }: Props) {
  const [picked, setPicked] = useState<ReadonlySet<ArtifactId>>(new Set(DEFAULT_SELECTION));
  const [copied, setCopied] = useState<ArtifactId | null>(null);
  const [preview, setPreview] = useState<ArtifactId | null>(null);

  function toggle(id: ArtifactId) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function textFor(id: ArtifactId): string {
    return byId(id).render(state, issues);
  }

  async function copy(id: ArtifactId) {
    try {
      await navigator.clipboard.writeText(textFor(id));
    } catch {
      // 클립보드 권한이 없으면 미리보기로 떨어뜨려 직접 복사하게 한다 — §B4 AC5.
      // 이 경우는 아직 받아간 것이 아니므로 판본을 찍지 않는다.
      setPreview(id);
      return;
    }
    onTake?.();
    setCopied(id);
    setTimeout(() => setCopied(null), 1600);
  }

  function one(id: ArtifactId) {
    downloadOne(state, issues, id);
    onTake?.();
  }

  function bundle(ids: readonly ArtifactId[]) {
    if (ids.length === 0) return;
    downloadBundle(state, issues, ids);
    onTake?.();
  }

  return (
    <div className="export">
      {GROUPS.map((g) => (
        <section className="export-group" key={g.audience}>
          <h4>
            {g.title} <span className="dim">{g.note}</span>
          </h4>

          {ARTIFACTS.filter((a) => a.audience === g.audience).map((a) => (
            <div className="export-item" key={a.id}>
              <label className="export-pick">
                <input
                  type="checkbox"
                  checked={picked.has(a.id)}
                  onChange={() => toggle(a.id)}
                />
                <span className="export-label">
                  {a.label}
                  <code>{a.file}</code>
                  <span className="hint">{a.hint}</span>
                </span>
              </label>

              <div className="export-actions">
                <button className="ghost" onClick={() => copy(a.id)}>
                  {copied === a.id ? '✓ 복사됨' : '복사'}
                </button>
                <button className="ghost" onClick={() => one(a.id)}>↓</button>
                <button className="ghost" onClick={() => setPreview(a.id)}>보기</button>
              </div>
            </div>
          ))}
        </section>
      ))}

      <div className="export-foot">
        <span className="hint">
          {picked.size === 0
            ? '받을 항목을 하나 이상 고르세요.'
            : `${picked.size}개 선택 · 압축 파일 하나로 받습니다.`}
        </span>
        <button
          className="primary"
          disabled={picked.size === 0}
          onClick={() => bundle([...picked])}
        >
          ↓ 선택 {picked.size}개 받기 (.zip)
        </button>
        <button className="ghost" onClick={() => bundle(ARTIFACTS.map((a) => a.id))}>
          전체 받기
        </button>
      </div>

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{byId(preview).label}</strong>
              <span className="dim">
                {renderOne(state, issues, preview).name} · {textFor(preview).length.toLocaleString()}자
              </span>
              <button className="ghost" onClick={() => setPreview(null)}>닫기</button>
            </div>
            <textarea readOnly value={textFor(preview)} onFocus={(e) => e.currentTarget.select()} />
            <p className="hint">전체 선택은 ⌘/Ctrl + A 입니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
