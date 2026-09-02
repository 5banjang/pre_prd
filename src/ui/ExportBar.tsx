// 내보내기 — FR-008 AC2 (다운로드 + 클립보드), FR-009 AC3 / FR-013 AC4 (각각 별도 버튼).

import { useState } from 'react';
import type { PRDState } from '../types/prd.js';
import { renderCompact, renderDraft, renderSetupGuide } from '../export/render.js';
import { downloadText, slug } from '../export/download.js';
import type { ValidationIssue } from '../validator/validate.js';

interface Props {
  state: PRDState;
  issues: readonly ValidationIssue[];
  /**
   * 산출물을 실제로 받아갔을 때 한 번 불린다 — 판본을 찍는 신호다 (FR-016 / §B2 AC3).
   * 미리보기만 열어본 것은 "받았다"가 아니므로 부르지 않는다.
   */
  onTake?: () => void;
}

type Kind = 'full' | 'compact' | 'setup';

type Render = (s: PRDState, issues: readonly ValidationIssue[]) => string;

// 전체본은 항상 renderDraft다 — 미정 목록을 맨 위에 붙인 판본이 정식 산출물이 되었다
// (개정안 #02 §A). renderFullPRD는 본문 조립기로만 남는다.
const DOCS: Record<Kind, { label: string; file: string; render: Render }> = {
  full: { label: '전체 PRD', file: 'PRD.md', render: renderDraft },
  compact: { label: '압축본', file: 'PRD-compact.md', render: renderCompact },
  setup: { label: '세팅 지침', file: 'SETUP.md', render: renderSetupGuide },
};

export function ExportBar({ state, issues, onTake }: Props) {
  const [copied, setCopied] = useState<Kind | null>(null);
  const [preview, setPreview] = useState<Kind | null>(null);

  function textFor(kind: Kind): string {
    return DOCS[kind].render(state, issues);
  }

  function labelFor(kind: Kind): string {
    return DOCS[kind].label;
  }

  async function copy(kind: Kind) {
    const text = textFor(kind);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없으면 미리보기로 떨어뜨려 직접 복사하게 한다.
      // 이 경우는 아직 받아간 것이 아니므로 판본을 찍지 않는다.
      setPreview(kind);
      return;
    }
    onTake?.();
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  }

  return (
    <div className="export">
      {(Object.keys(DOCS) as Kind[]).map((kind) => (
        <div className="export-item" key={kind}>
          <span className="export-label">{DOCS[kind].label}</span>
          <button onClick={() => copy(kind)}>
            {copied === kind ? '✓ 복사됨' : '복사'}
          </button>
          <button
            className="ghost"
            onClick={() => {
              downloadText(`${slug(state.projectName)}-${DOCS[kind].file}`, textFor(kind));
              onTake?.();
            }}
          >
            ⭳ .md
          </button>
          <button className="ghost" onClick={() => setPreview(kind)}>
            보기
          </button>
        </div>
      ))}

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{labelFor(preview)}</strong>
              <span className="dim">{textFor(preview).length.toLocaleString()}자</span>
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
