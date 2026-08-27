// 내보내기 — FR-008 AC2 (다운로드 + 클립보드), FR-009 AC3 / FR-013 AC4 (각각 별도 버튼).

import { useState } from 'react';
import type { PRDState } from '../types/prd.js';
import { renderCompact, renderFullPRD, renderSetupGuide } from '../export/render.js';

interface Props {
  state: PRDState;
  canExport: boolean;
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

export function ExportBar({ state, canExport }: Props) {
  const [copied, setCopied] = useState<Kind | null>(null);
  const [preview, setPreview] = useState<Kind | null>(null);

  async function copy(kind: Kind) {
    const text = DOCS[kind].render(state);
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

      {preview && (
        <div className="modal" onClick={() => setPreview(null)}>
          <div className="modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <strong>{DOCS[preview].label}</strong>
              <span className="dim">{DOCS[preview].render(state).length.toLocaleString()}자</span>
              <button className="ghost" onClick={() => setPreview(null)}>닫기</button>
            </div>
            <textarea readOnly value={DOCS[preview].render(state)} onFocus={(e) => e.currentTarget.select()} />
            <p className="hint">전체 선택은 ⌘/Ctrl + A 입니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
