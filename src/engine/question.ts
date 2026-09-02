// 객관식 질문 카드 — FR-014.
//
// 엔진의 질문을 선택지로 제시하고, 사용자의 선택·주관식을 하나의 입력으로 조립한다.
// 질문은 턴에 종속된 일회성 데이터라 PRDState에 넣지 않는다.

export interface AnswerOption {
  /** "A" | "B" | "C" | "D" */
  key: string;
  label: string;
  /** 장단점 설명. 스펙 §5.2 절대규칙 4를 선택 시점에 전달하는 자리다. */
  detail: string;
  recommended: boolean;
}

export interface EngineQuestion {
  /** "Q1" | "Q2" | "Q3" */
  id: string;
  text: string;
  /** 비어 있으면 순수 주관식 질문이다. */
  options: AnswerOption[];
}

/** 한 질문에 대한 사용자 응답. 선택과 주관식은 서로 독립이다. */
export interface QuestionAnswer {
  /** 고른 보기의 key. 고르지 않았으면 null */
  choice: string | null;
  /** 부연 의견. 없으면 빈 문자열 */
  note: string;
  /**
   * "모르겠어요 — 네가 정해줘"를 눌렀다 — 개정안 #02 §B5-2.
   * 엔진이 기본값을 정하고 그것을 가정·미해결 질문으로 기록한다. 진행은 뚫리고 기록은 남는다.
   */
  unknown?: boolean;
}

export type AnswerMap = Record<string, QuestionAnswer>;

/** 이 질문에 어떤 형태로든 답했는가. "모르겠어요"도 답이다 — 진행을 막지 않는다. */
export function isAnswered(a: QuestionAnswer | undefined): boolean {
  return !!a && (a.choice !== null || a.note.trim().length > 0 || a.unknown === true);
}

/** 답한 질문 수 — "n/3 완료" 표시용. */
export function answeredCount(questions: readonly EngineQuestion[], answers: AnswerMap): number {
  return questions.filter((q) => isAnswered(answers[q.id])).length;
}

/**
 * 선택과 주관식을 엔진에 보낼 하나의 사용자 입력으로 조립한다 — FR-014 AC6.
 * 자유 입력(freeText)이 있으면 뒤에 덧붙인다. 둘 다 없으면 빈 문자열.
 */
export function composeAnswer(
  questions: readonly EngineQuestion[],
  answers: AnswerMap,
  freeText = '',
): string {
  const blocks: string[] = [];

  for (const q of questions) {
    const a = answers[q.id];
    if (!a || !isAnswered(a)) continue;

    const lines = [`${q.id}. ${q.text}`];
    if (a.unknown) {
      // 엔진에게 결정권을 넘긴다. 시스템 지침의 "모르겠음 처리"가 받는다.
      lines.push('→ 모르겠습니다. 합리적인 기본값을 정하고, 무엇을 정했는지 가정으로 기록해 주세요.');
    }
    if (a.choice !== null) {
      const opt = q.options.find((o) => o.key === a.choice);
      lines.push(`→ 선택: ${opt ? `${opt.key}) ${opt.label}` : a.choice}`);
    }
    if (a.note.trim()) lines.push(`→ 추가 의견: ${a.note.trim()}`);
    blocks.push(lines.join('\n'));
  }

  const answered = blocks.length > 0 ? `[질문 답변]\n${blocks.join('\n\n')}` : '';
  const free = freeText.trim();

  if (answered && free) return `${answered}\n\n[추가 입력]\n${free}`;
  return answered || free;
}

/** 답하지 않고 넘어간 질문. 엔진이 다시 물을 수 있도록 reply에 반영된다. */
export function unansweredQuestions(
  questions: readonly EngineQuestion[],
  answers: AnswerMap,
): EngineQuestion[] {
  return questions.filter((q) => !isAnswered(answers[q.id]));
}
