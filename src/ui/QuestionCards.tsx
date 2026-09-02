// 객관식 질문 카드 — FR-014.
// 보기를 클릭해 답하거나, 주관식 칸에 자유롭게 부연한다.

import { answeredCount, type AnswerMap, type EngineQuestion } from '../engine/question.js';
import type { PRDState } from '../types/prd.js';
import { ConsultBox } from './ConsultBox.js';

interface Props {
  state: PRDState;
  questions: readonly EngineQuestion[];
  answers: AnswerMap;
  disabled: boolean;
  onChange: (id: string, patch: { choice?: string | null; note?: string }) => void;
  onMerge: (next: AnswerMap) => void;
}

export function QuestionCards({ state, questions, answers, disabled, onChange, onMerge }: Props) {
  if (questions.length === 0) return null;
  const done = answeredCount(questions, answers);

  return (
    <div className="qcards">
      <div className="qcards-head">
        <div>
          <strong>기획 질문</strong>
          <p className="hint">
            보기를 클릭해 선택하거나, 주관식 칸에 의견을 적어 제출하세요. 건너뛰고 자유롭게 입력해도 됩니다.
          </p>
        </div>
        <div className={`qcount ${done === questions.length ? 'full' : ''}`}>
          {done} / {questions.length}
        </div>
      </div>

      {questions.map((q) => {
        const a = answers[q.id] ?? { choice: null, note: '' };
        return (
          <div className="qcard" key={q.id}>
            <div className="qtitle">
              <span className="qid">{q.id}</span>
              <span>{q.text}</span>
            </div>

            {q.options.map((o) => {
              const picked = a.choice === o.key;
              return (
                <button
                  type="button"
                  key={o.key}
                  className={`qopt ${picked ? 'picked' : ''}`}
                  disabled={disabled}
                  aria-pressed={picked}
                  // 같은 보기를 다시 누르면 선택 해제 — 잘못 누른 걸 되돌릴 수 있어야 한다
                  onClick={() => onChange(q.id, { choice: picked ? null : o.key })}
                >
                  <span className={`radio ${picked ? 'on' : ''}`} aria-hidden />
                  <span className="qopt-body">
                    <span className="qopt-label">
                      <b>{o.key})</b> {o.label}
                      {o.recommended && <span className="rec">추천</span>}
                    </span>
                    {o.detail && <span className="qopt-detail">{o.detail}</span>}
                  </span>
                </button>
              );
            })}

            <label className="qnote">
              <span className="qnote-label">
                {q.options.length > 0 ? `${q.id} 기타 / 주관식 상세 의견 (선택)` : `${q.id} 답변`}
              </span>
              <input
                type="text"
                value={a.note}
                disabled={disabled}
                placeholder={q.options.length > 0 ? '추가 요구사항이나 특이사항…' : '자유롭게 적어주세요'}
                onChange={(e) => onChange(q.id, { note: e.target.value })}
              />
            </label>
          </div>
        );
      })}

      <ConsultBox
        state={state}
        questions={questions}
        answers={answers}
        disabled={disabled}
        onMerge={onMerge}
      />
    </div>
  );
}
