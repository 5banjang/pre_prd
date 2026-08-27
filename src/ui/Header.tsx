// 헤더 — 턴 수와 누적 추정 비용 (FR-012 AC1, AC3).

import { useState } from 'react';
import { ENGINE_MODEL, estimateCost } from '../config.js';
import type { PRDState } from '../types/prd.js';
import { Settings } from './Settings.js';

interface Props {
  state: PRDState;
  inputTokens: number;
  outputTokens: number;
  apiKey: string;
  saved: 'idle' | 'saving' | 'saved' | 'failed';
  onKeyChange: (key: string) => void;
  onClearKey: () => void;
  onImport: (state: PRDState, warnings: string[]) => void;
  onReset: () => void;
}

export function Header(p: Props) {
  const [open, setOpen] = useState(false);
  const cost = estimateCost(p.inputTokens, p.outputTokens);

  return (
    <header className="header">
      <h1>PRD Architect</h1>

      <div className="meter">
        <span>턴 {p.state.turn}</span>
        <span aria-hidden>·</span>
        <span title={`입력 ${p.inputTokens.toLocaleString()} / 출력 ${p.outputTokens.toLocaleString()} 토큰`}>
          추정 ${cost.toFixed(4)}
        </span>
        {!ENGINE_MODEL.verified && (
          <span className="tag-unverified" title={ENGINE_MODEL.caveat ?? ''}>단가 [미검증]</span>
        )}
        {p.saved === 'failed' && (
          <span className="tag-unverified" title="브라우저 저장소에 쓰지 못했습니다">저장 실패</span>
        )}
      </div>

      <button className="ghost" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
        ⚙ 설정
      </button>

      {open && (
        <Settings
          apiKey={p.apiKey}
          state={p.state}
          saved={p.saved}
          onKeyChange={p.onKeyChange}
          onClearKey={p.onClearKey}
          onImport={p.onImport}
          onReset={p.onReset}
          onClose={() => setOpen(false)}
        />
      )}
    </header>
  );
}
