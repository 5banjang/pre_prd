// 대화 영역 — FR-001.
// 엔진 응답의 reply만 표시한다. patches는 표시하지 않는다 (AC2).

import { useEffect, useRef, useState } from 'react';
import type { HistoryEntry, SectionId } from '../types/prd.js';
import type { EngineError } from '../engine/geminiAdapter.js';
import type { RejectedPatch } from '../engine/applyPatches.js';
import { answeredCount, composeAnswer, type AnswerMap, type EngineQuestion } from '../engine/question.js';
import { QuestionCards } from './QuestionCards.js';

interface Props {
  history: readonly HistoryEntry[];
  status: 'idle' | 'thinking';
  error: EngineError | null;
  rejected: readonly RejectedPatch[];
  hasKey: boolean;
  showNudge: boolean;
  questions: readonly EngineQuestion[];
  answers: AnswerMap;
  onAnswer: (id: string, patch: { choice?: string | null; note?: string }) => void;
  onSend: (text: string) => void;
  onDismissError: () => void;
  onUnlock: (id: SectionId) => void;
}

/** 오류 종류별로 다른 안내를 준다 — NFR-004. */
function errorHint(kind: EngineError['kind']): string {
  switch (kind) {
    case 'auth': return '설정에서 API 키를 확인해 주세요. 진행 중인 내용은 그대로 있습니다.';
    case 'network': return '연결을 확인한 뒤 다시 보내주세요.';
    case 'rate_limit': return '잠시 후 다시 시도해 주세요.';
    case 'schema': return '같은 내용을 다시 보내면 대개 해결됩니다.';
    case 'server': return '엔진 쪽 일시적 문제입니다. 잠시 후 재시도해 주세요.';
    default: return '';
  }
}

export function ChatPanel(p: Props) {
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [p.history.length, p.status]);

  const busy = p.status === 'thinking';
  const answered = answeredCount(p.questions, p.answers);
  // 선택지에 답했거나 직접 입력했으면 보낼 수 있다 — FR-014 AC5
  const canSubmit = !busy && p.hasKey && (answered > 0 || text.trim().length > 0);

  function submit() {
    if (!canSubmit) return;
    const composed = composeAnswer(p.questions, p.answers, text);
    if (!composed) return;
    setText('');
    p.onSend(composed);
  }

  const lockedRejects = p.rejected.filter((r) => r.reason === 'section_locked');

  return (
    <section className="chat">
      <div className="messages">
        {p.history.length === 0 && (
          <div className="intro">
            <h2>아이디어를 한 줄로 적어보세요.</h2>
            <p>
              엔진이 취조를 시작합니다. 먼저 예산·보유 API 키·배포 환경부터 확정한 뒤
              기능 논의로 넘어갑니다.
            </p>
            <p className="hint">
              모든 데이터는 이 브라우저에만 저장됩니다. 서버로 전송되지 않습니다.
            </p>
          </div>
        )}

        {p.history.map((m, i) => (
          <div key={i} className={`msg ${m.role}`}>
            <div className="who">{m.role === 'user' ? '나' : '엔진'}</div>
            <div className="bubble">{m.text}</div>
          </div>
        ))}

        {busy && (
          <div className="msg engine">
            <div className="who">엔진</div>
            <div className="bubble thinking"><span /><span /><span /></div>
          </div>
        )}

        {lockedRejects.length > 0 && (
          <div className="notice locked">
            {lockedRejects.map((r, i) => (
              <div key={i}>
                {r.message}
                {r.sectionId && (
                  <button className="link" onClick={() => p.onUnlock(r.sectionId!)}>
                    잠금 해제
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {!busy && (
          <QuestionCards
            questions={p.questions}
            answers={p.answers}
            disabled={busy}
            onChange={p.onAnswer}
          />
        )}

        {p.showNudge && (
          <div className="notice nudge">
            25턴이 넘었습니다. 핵심 섹션부터 마무리할까요?
          </div>
        )}

        {p.error && (
          <div className="notice error">
            <strong>{p.error.message}</strong>
            <div className="hint">{errorHint(p.error.kind)}</div>
            <button className="link" onClick={p.onDismissError}>닫기</button>
          </div>
        )}

        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          value={text}
          rows={3}
          placeholder={
            !p.hasKey ? '설정에서 API 키를 먼저 입력해 주세요'
              : p.questions.length > 0 ? '위 질문에 답하거나, 여기에 자유롭게 적어주세요…  (⌘/Ctrl + Enter 전송)'
                : '입력…  (⌘/Ctrl + Enter 전송)'
          }
          disabled={!p.hasKey}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); submit(); }
          }}
        />
        <button onClick={submit} disabled={!canSubmit}>
          {busy ? '…' : answered > 0 ? `답변 ${answered}건 전송` : '전송'}
        </button>
      </div>
    </section>
  );
}
