// 설정 화면 — FR-011(키 관리) + FR-010 AC3(상태 파일 입출력).

import { useRef, useState } from 'react';
import { ENGINE_MODEL } from '../config.js';
import type { PRDState } from '../types/prd.js';
import { parseStateFile, serializeState, stateFileName } from '../storage/persist.js';

interface Props {
  apiKey: string;
  state: PRDState;
  saved: 'idle' | 'saving' | 'saved' | 'failed';
  onKeyChange: (key: string) => void;
  onClearKey: () => void;
  onImport: (state: PRDState, warnings: string[]) => void;
  onReset: () => void;
  onClose: () => void;
}

export function Settings(p: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  function exportState() {
    const url = URL.createObjectURL(
      new Blob([serializeState(p.state)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = stateFileName(p.state);
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function importState(file: File) {
    const r = parseStateFile(await file.text());
    if (!r.ok) {
      setMsg({ kind: 'err', text: r.error });
      return;
    }
    p.onImport(r.state, r.warnings);
    setMsg({
      kind: 'ok',
      text: `턴 ${r.state.turn} 상태를 불러왔습니다.${r.warnings.length ? ` (${r.warnings.join(' ')})` : ''}`,
    });
  }

  return (
    <div className="settings">
      <div className="settings-head">
        <strong>설정</strong>
        <button className="ghost" onClick={p.onClose}>닫기</button>
      </div>

      <section>
        <label htmlFor="apikey">Google API 키</label>
        <div className="row">
          <input
            id="apikey"
            type="password"
            value={p.apiKey}
            placeholder="AI Studio에서 발급받은 키"
            onChange={(e) => p.onKeyChange(e.target.value)}
          />
          <button className="ghost" disabled={!p.apiKey} onClick={p.onClearKey}>삭제</button>
        </div>
        <p className="hint">
          키는 이 브라우저에만 저장되며 서버로 전송되지 않습니다 (LLM 벤더 API 호출 제외).
          {' '}엔진: <code>{ENGINE_MODEL.id}</code>
        </p>
      </section>

      <section>
        <label>세션</label>
        <div className="row">
          <button className="ghost" onClick={exportState}>↓ 상태 내보내기</button>
          <button className="ghost" onClick={() => fileRef.current?.click()}>↑ 상태 불러오기</button>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void importState(f);
            e.target.value = ''; // 같은 파일을 다시 골라도 이벤트가 오게 한다
          }}
        />
        <p className="hint">
          매 턴 자동 저장됩니다{' '}
          {p.saved === 'saved' && <span className="ok-text">· 저장됨</span>}
          {p.saved === 'saving' && <span>· 저장 중…</span>}
          {p.saved === 'failed' && <span className="err-text">· 저장 실패 — 파일로 내보내 두세요</span>}
        </p>
      </section>

      <section>
        <label>초기화</label>
        {confirmReset ? (
          <div className="row">
            <span className="hint err-text">저장된 대화와 PRD가 모두 삭제됩니다.</span>
            <button onClick={() => { p.onReset(); setConfirmReset(false); setMsg(null); }}>
              삭제
            </button>
            <button className="ghost" onClick={() => setConfirmReset(false)}>취소</button>
          </div>
        ) : (
          <button className="ghost" onClick={() => setConfirmReset(true)}>새 세션 시작</button>
        )}
      </section>

      {msg && (
        <p className={`hint ${msg.kind === 'err' ? 'err-text' : 'ok-text'}`}>{msg.text}</p>
      )}
    </div>
  );
}
