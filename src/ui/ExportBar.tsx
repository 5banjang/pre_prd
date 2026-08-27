// 내보내기 — FR-008 AC2 (다운로드 + 클립보드), FR-009 AC3 / FR-013 AC4 (각각 별도 버튼).

import { useState } from 'react';
import type { PRDState } from '../types/prd.js';
import { renderCompact, renderDraft, renderFullPRD, renderSetupGuide } from '../export/render.js';
import type { ValidationIssue } from '../validator/validate.js';

interface Props {
  state: PRDState;
  canExport: boolean;
  issues: readonly ValidationIssue[];
}

type Kind = 'full' | 'compact' | 'setup';

const DOCS: Record<Kind, { label: string; file: string; render: (s: PRDState) => string }> = {
  full: { label: '전체 PRD', file: 'PRD.md', render: renderFullPRD },
  compact: { label: '압축본', file: 'PRD-compact.md', render: renderCompact },
  setup: { label: '세팅 지침', file: 'SETUP.md', render: renderSetupGuide },
};

function slug(name: string): string {
  return (name.trim() || 'prd').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);
}

function download(filename: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  // 즉시 해제하면 일부 브라우저에서 저장이 취소된다
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type PreviewKind = Kind | 'draft';

export function ExportBar({ state, canExport, issues }: Props) {
  const [copied, setCopied] = useState<PreviewKind | null>(null);
  const [preview, setPreview] = useState<PreviewKind | null>(null);

  const draftText = () => renderDraft(state, issues);
  const draftLabel = '전체 PRD (초안)';
  const draftFile = () => `${slug(state.projectName)}-PRD-draft.md`;

  function textFor(kind: PreviewKind): string {
    return kind === 'draft' ? draftText() : DOCS[kind].render(state);
  }

  function labelFor(kind: PreviewKind): string {
    return kind === 'draft' ? draftLabel : DOCS[kind].label;
  }

  async function copy(kind: PreviewKind) {
    const text = textFor(kind);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      // 클립보드 권한이 없으면 미리보기로 떨어뜨려 직접 복사하게 한다
      setPreview(kind);
      return;
    }
    setCopied(kind);
    setTimeout(() => setCopied(null), 1600);
  }

  const hint = canExport ? '' : '차단 이슈를 먼저 해결하세요';

  return (
    <div className="export">
      {(Object.keys(DOCS) as Kind[]).map((kind) => (
        <div className="export-item" key={kind}>
          <span className="export-label">{DOCS[kind].label}</span>
          <button disabled={!canExport} title={hint} onClick={() => copy(kind)}>
            {copied === kind ? '✓ 복사됨' : '복사'}
          </button>
          <button
            className="ghost"
            disabled={!canExport}
            title={hint}
            onClick={() => download(`${slug(state.projectName)}-${DOCS[kind].file}`, DOCS[kind].render(state))}
          >
            ⭳ .md
          </button>
          <button className="ghost" disabled={!canExport} title={hint} onClick={() => setPreview(kind)}>
            보기
          </button>
        </div>
      ))}

      {!canExport && (
        <div className="export-draft">
          <div className="export-item">
            <span className="export-label">{draftLabel}</span>
            <button onClick={() => copy('draft')}>
              {copied === 'draft' ? '✓ 복사됨' : '복사'}
            </button>
            <button className="ghost" onClick={() => download(draftFile(), draftText())}>
              ⭳ .md
            </button>
            <button className="ghost" onClick={() => setPreview('draft')}>
              보기
            </button>
          </div>
          <p className="hint warn">차단 이슈를 해결하지 않은 상태 그대로, 문서 맨 위에 미해결 목록을 붙여서 내보낸다.</p>
        </div>
      )}

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
