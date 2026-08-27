import { describe, it, expect } from 'vitest';
import {
  answeredCount,
  composeAnswer,
  unansweredQuestions,
  type AnswerMap,
  type EngineQuestion,
} from './question.js';
import { toQuestions } from './geminiAdapter.js';

const QS: EngineQuestion[] = [
  {
    id: 'Q1',
    text: 'AI 합성 처리 방식을 어떻게 정의할까요?',
    options: [
      { key: 'A', label: '서버 사이드 처리', detail: '(장점: 높은 품질 / 단점: 서버 비용)', recommended: true },
      { key: 'B', label: '온디바이스 처리', detail: '(장점: 유지비 0 / 단점: 저사양 기기 품질 저하)', recommended: false },
    ],
  },
  { id: 'Q2', text: '월 예산 상한은?', options: [] },
  {
    id: 'Q3',
    text: '배포 대상은?',
    options: [
      { key: 'A', label: '로컬 전용', detail: '', recommended: false },
      { key: 'B', label: 'Vercel', detail: '', recommended: false },
    ],
  },
];

const ans = (m: AnswerMap): AnswerMap => m;

describe('answeredCount — FR-014 AC1', () => {
  it('선택이나 주관식 중 하나만 있어도 답한 것으로 센다', () => {
    expect(answeredCount(QS, ans({
      Q1: { choice: 'B', note: '' },
      Q2: { choice: null, note: '월 3만원' },
    }))).toBe(2);
  });

  it('빈 주관식은 답으로 치지 않는다', () => {
    expect(answeredCount(QS, ans({ Q1: { choice: null, note: '   ' } }))).toBe(0);
  });

  it('답이 없으면 0', () => {
    expect(answeredCount(QS, {})).toBe(0);
  });
});

describe('composeAnswer — FR-014 AC6', () => {
  it('선택과 주관식을 하나의 입력으로 조립한다', () => {
    const out = composeAnswer(QS, ans({
      Q1: { choice: 'B', note: '배터리 소모가 걱정됩니다' },
      Q2: { choice: null, note: '월 3만원' },
    }));
    expect(out).toContain('[질문 답변]');
    expect(out).toContain('Q1. AI 합성 처리 방식을 어떻게 정의할까요?');
    expect(out).toContain('→ 선택: B) 온디바이스 처리');
    expect(out).toContain('→ 추가 의견: 배터리 소모가 걱정됩니다');
    expect(out).toContain('→ 추가 의견: 월 3만원');
  });

  it('답하지 않은 질문은 넣지 않는다', () => {
    const out = composeAnswer(QS, ans({ Q1: { choice: 'A', note: '' } }));
    expect(out).toContain('Q1.');
    expect(out).not.toContain('Q2.');
    expect(out).not.toContain('Q3.');
  });

  it('자유 입력만 있어도 전송할 수 있다 — AC5', () => {
    expect(composeAnswer(QS, {}, '그냥 알아서 해주세요')).toBe('그냥 알아서 해주세요');
  });

  it('선택과 자유 입력이 함께 있으면 둘 다 담는다', () => {
    const out = composeAnswer(QS, ans({ Q1: { choice: 'A', note: '' } }), '추가로 다크모드도요');
    expect(out).toContain('[질문 답변]');
    expect(out).toContain('[추가 입력]');
    expect(out).toContain('추가로 다크모드도요');
  });

  it('아무것도 없으면 빈 문자열', () => {
    expect(composeAnswer(QS, {}, '   ')).toBe('');
  });

  it('알 수 없는 보기 key도 버리지 않고 그대로 싣는다', () => {
    expect(composeAnswer(QS, ans({ Q1: { choice: 'Z', note: '' } }))).toContain('→ 선택: Z');
  });
});

describe('unansweredQuestions', () => {
  it('답하지 않은 질문만 돌려준다', () => {
    const left = unansweredQuestions(QS, ans({ Q1: { choice: 'A', note: '' } }));
    expect(left.map((q) => q.id)).toEqual(['Q2', 'Q3']);
  });
});

describe('toQuestions — 엔진 응답 파싱', () => {
  it('정상 질문을 읽는다', () => {
    const qs = toQuestions({
      questions: [{
        id: 'Q1', text: '방식은?',
        options: [
          { key: 'A', label: '가', detail: '설명', recommended: true },
          { key: 'B', label: '나', detail: '설명', recommended: false },
        ],
      }],
    });
    expect(qs).toHaveLength(1);
    expect(qs[0]!.options[0]!.recommended).toBe(true);
  });

  it('최대 3개, 보기는 최대 4개로 자른다', () => {
    const qs = toQuestions({
      questions: Array.from({ length: 6 }, (_, i) => ({
        id: `Q${i}`, text: 't',
        options: Array.from({ length: 7 }, (_, j) => ({ key: `K${j}`, label: 'l', detail: '', recommended: false })),
      })),
    });
    expect(qs).toHaveLength(3);
    expect(qs[0]!.options).toHaveLength(4);
  });

  it('보기가 1개뿐이면 주관식으로 떨어뜨린다', () => {
    const qs = toQuestions({
      questions: [{ id: 'Q1', text: 't', options: [{ key: 'A', label: '하나', detail: '', recommended: false }] }],
    });
    expect(qs[0]!.options).toEqual([]);
  });

  it('본문 없는 질문은 버린다', () => {
    expect(toQuestions({ questions: [{ id: 'Q1', text: '  ', options: [] }] })).toEqual([]);
  });

  it('questions가 없거나 배열이 아니면 빈 배열', () => {
    expect(toQuestions({})).toEqual([]);
    expect(toQuestions({ questions: 'nope' })).toEqual([]);
  });

  it('망가진 보기는 건너뛰고 나머지를 살린다', () => {
    const qs = toQuestions({
      questions: [{
        id: 'Q1', text: 't',
        options: [null, { key: 'A', label: '가', detail: '', recommended: false }, { key: 'B', label: '나' }],
      }],
    });
    expect(qs[0]!.options.map((o) => o.key)).toEqual(['A', 'B']);
  });
});
