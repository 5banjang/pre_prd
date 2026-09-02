// 다른 AI와 상의하고 오기 — 질문 카드 아래 붙는 왕복 창구.
//
// 흐름: [질문 복사] → 쓰던 AI에 붙여넣고 상의 → 답변 블록 복사 → 여기 붙여넣고 [답변 읽어오기]
// 읽은 답은 카드에 채워질 뿐 자동으로 전송되지 않는다. 보내는 것은 언제나 사용자다.

import { useState } from 'react';
import type { PRDState } from '../types/prd.js';
import { buildConsultPrompt, mergeAnswers, parseConsultReply } from '../engine/handoff.js';
import type { AnswerMap, EngineQuestion } from '../engine/question.js';

interface Props {
  state: PRDState;
  questions: readonly EngineQuestion[];
  answers: AnswerMap;
  disabled: boolean;
  onMerge: (next: AnswerMap) => void;
}

export function ConsultBox(p: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  /** 클립보드가 막힌 환경(비 HTTPS·권한 거부)에서 직접 긁어갈 원문 */
  const [manual, setManual] = useState('');
  const [reply, setReply] = useState('');
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  async function copy() {
    const text = buildConsultPrompt(p.state, p.questions);
    try {
      await navigator.clipboard.writeText(text);
      setManual('');
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      setManual(text);
    }
  }

  function read() {
    const { answers, ignored } = parseConsultReply(reply, p.questions);
    if (answers.length === 0) {
      setResult({
        ok: false,
        text: '읽을 수 있는 답변이 없습니다. "Q1: A" 나 "Q1 의견: …" 같은 줄이 있는지 확인해 주세요.',
      });
      return;
    }
    p.onMerge(mergeAnswers(p.answers, answers));
    const dropped = ignored.length > 0
      ? ` ${ignored.join(', ')}은 이번 질문에 없어 넘겼습니다.`
      : '';
    setResult({
      ok: true,
      text: `답변 ${answers.length}건을 위 카드에 채웠습니다.${dropped} 확인한 뒤 전송하세요.`,
    });
    setReply('');
  }

  if (!open) {
    return (
      <div className="consult closed">
        <button className="link" onClick={() => setOpen(true)} disabled={p.disabled}>
          혼자 정하기 어렵나요? 다른 AI와 상의하고 오기
        </button>
      </div>
    );
  }

  return (
    <div className="consult">
      <div className="consult-head">
        <strong>다른 AI와 상의하기</strong>
        <button className="link" onClick={() => setOpen(false)}>접기</button>
      </div>
      <p className="hint">
        지금까지 정해진 내용과 위 질문을 한 덩어리로 복사합니다. 쓰던 AI에 붙여넣고 상의한 뒤,
        받은 답변 블록을 아래에 붙여넣으면 카드가 채워집니다.
      </p>

      <div className="consult-step">
        <span className="step-no">1</span>
        <button onClick={copy} disabled={p.disabled}>
          {copied ? '복사됨' : '질문 복사'}
        </button>
        <span className="hint">맥락까지 함께 복사됩니다</span>
      </div>

      {manual && (
        <>
          <p className="hint err-text">
            복사가 막힌 환경입니다. 아래 내용을 직접 선택해 복사해 주세요.
          </p>
          <textarea className="consult-manual" readOnly rows={6} value={manual} onFocus={(e) => e.target.select()} />
        </>
      )}

      <div className="consult-step">
        <span className="step-no">2</span>
        <span className="hint">받은 답변을 아래에 붙여넣으세요</span>
      </div>
      <textarea
        rows={5}
        value={reply}
        disabled={p.disabled}
        placeholder={'[답변]\nQ1: B\nQ1 의견: 초기엔 고정비를 안 쓰는 쪽이 낫다\n…'}
        onChange={(e) => setReply(e.target.value)}
      />
      <div className="consult-actions">
        <button onClick={read} disabled={p.disabled || reply.trim() === ''}>답변 읽어오기</button>
        {result && (
          <span className={result.ok ? 'ok-text' : 'err-text'}>{result.text}</span>
        )}
      </div>
    </div>
  );
}
