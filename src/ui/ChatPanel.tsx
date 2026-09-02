// 대화 영역 — FR-001.
// 엔진 응답의 reply만 표시한다. patches는 표시하지 않는다 (AC2).

import { useEffect, useRef, useState } from 'react';
import type { HistoryEntry, PRDState, SectionId } from '../types/prd.js';
import type { EngineError } from '../engine/geminiAdapter.js';
import type { RejectedPatch } from '../engine/applyPatches.js';
import { answeredCount, composeAnswer, type AnswerMap, type EngineQuestion } from '../engine/question.js';
import { QuestionCards } from './QuestionCards.js';
import { AttachBar } from './AttachBar.js';
import type { ExtractInput } from '../engine/extract.js';

interface Props {
  /** 상의 브리핑에 실을 맥락 — 질문만 내보내면 상대 AI가 일반론으로 답한다 */
  state: PRDState;
  history: readonly HistoryEntry[];
  status: 'idle' | 'thinking';
  error: EngineError | null;
  rejected: readonly RejectedPatch[];
  hasKey: boolean;
  showNudge: boolean;
  questions: readonly EngineQuestion[];
  answers: AnswerMap;
  onAnswer: (id: string, patch: { choice?: string | null; note?: string }) => void;
  onMergeAnswers: (next: AnswerMap) => void;
  onSend: (text: string) => void;
  /** 지금 문서를 뺀 보관함의 문서 수. 0이면 "기존 문서 열기"를 띄울 이유가 없다 */
  otherDocCount: number;
  onOpenLibrary: () => void;
  /** FR-015 자료 첨부 — 읽는 중인 파일명, 형식·크기 거부 문구 */
  reading: string | null;
  refusal: string | null;
  onAttach: (input: ExtractInput) => void;
  onRefuse: (message: string | null) => void;
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
  const inputRef = useRef<HTMLTextAreaElement>(null);

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

  /** 입력칸에 쓰던 글이 있으면 "이 자료를 어디에 쓰라"는 메모로 함께 넘긴다. */
  function attach(input: ExtractInput) {
    const note = text.trim();
    if (note) setText('');
    p.onAttach({ ...input, note });
  }

  return (
    <section className="chat">
      <div className="messages">
        {p.history.length === 0 && (
          <div className="intro">
            <h2>무엇부터 할까요?</h2>

            <div className="start-cards">
              <button className="start-card" onClick={() => inputRef.current?.focus()}>
                <strong>백지에서 시작</strong>
                <span>
                  한 줄짜리 아이디어면 됩니다. 엔진이 예산·만들 것·안 만들 것부터 취조합니다.
                  모르는 건 <b>모르겠어요</b>를 눌러 넘겨도 됩니다.
                </span>
              </button>

              {p.otherDocCount > 0 && (
                <button className="start-card" onClick={p.onOpenLibrary}>
                  <strong>기존 문서 열기 <span className="dim">{p.otherDocCount}</span></strong>
                  <span>하던 인터뷰를 이어가거나, 지난 판본의 산출물을 다시 받습니다.</span>
                </button>
              )}
            </div>

            {!p.hasKey && (
              <p className="hint warn-text">
                아직 API 키가 없습니다. 오른쪽 위 <b>⚙ 설정</b>에서 넣어주세요. 키는 이 브라우저에만 저장됩니다.
              </p>
            )}
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
            state={p.state}
            questions={p.questions}
            answers={p.answers}
            disabled={busy}
            onChange={p.onAnswer}
            onMerge={p.onMergeAnswers}
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

      <AttachBar
        state={p.state}
        reading={p.reading}
        refusal={p.refusal}
        disabled={!p.hasKey || busy}
        onPick={attach}
        onRefuse={p.onRefuse}
      />

      <div className="composer">
        <textarea
          ref={inputRef}
          value={text}
          rows={3}
          placeholder={
            !p.hasKey ? '설정에서 API 키를 먼저 입력해 주세요'
              : p.questions.length > 0 ? '위 질문에 답하거나, 여기에 자유롭게 적어주세요…  (⌘/Ctrl + Enter 전송)'
                : '입력…  (⌘/Ctrl + Enter 전송)'
          }
          disabled={!p.hasKey || p.reading !== null}
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
