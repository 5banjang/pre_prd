import { describe, it, expect } from 'vitest';
import { buildConsultPrompt, mergeAnswers, parseConsultReply } from './handoff.js';
import type { AnswerMap, EngineQuestion } from './question.js';
import { createEmptyState, type PRDState } from '../types/prd.js';

const QS: EngineQuestion[] = [
  {
    id: 'Q1',
    text: '배포 환경을 어떻게 하시겠습니까?',
    options: [
      { key: 'A', label: '정적 호스팅', detail: '장점: 무료 / 단점: 서버 로직 불가', recommended: true },
      { key: 'B', label: '서버 포함', detail: '장점: 유연 / 단점: 고정비', recommended: false },
    ],
  },
  {
    id: 'Q2',
    text: '검증 강도를 어디까지 하시겠습니까?',
    options: [
      { key: 'A', label: '핵심만', detail: '', recommended: false },
      { key: 'B', label: '엄격하게', detail: '', recommended: false },
    ],
  },
  { id: 'Q3', text: '예산은 얼마입니까?', options: [] },
];

function filled(): PRDState {
  const s = createEmptyState('테스트 제품');
  s.sections.S2 = { ...s.sections.S2, content: '- 인터뷰 루프\n- 검증기', status: 'drafting' };
  s.requirements = [{
    id: 'FR-001', title: '인터뷰', description: '설명',
    acceptanceCriteria: ['조건 시 반환한다', '실패 시 표시한다'],
    priority: 'Must', dependsOn: [], section: 'FR',
  }];
  s.unverifiedTerms = ['Gemini 3.7 Flash $0.75/1M'];
  return s;
}

describe('상의 브리핑', () => {
  const p = buildConsultPrompt(filled(), QS);

  it('질문 원문과 보기·장단점을 전부 싣는다', () => {
    expect(p).toContain('배포 환경을 어떻게 하시겠습니까?');
    expect(p).toContain('정적 호스팅');
    expect(p).toContain('장점: 무료 / 단점: 서버 로직 불가');
    expect(p).toContain('예산은 얼마입니까?');
  });

  it('맥락을 함께 보낸다 — 질문만 던지면 상대가 일반론으로 답한다', () => {
    expect(p).toContain('테스트 제품');
    expect(p).toContain('인터뷰 루프');
    expect(p).toContain('FR-001');
    expect(p).toContain('Gemini 3.7 Flash $0.75/1M');
  });

  it('돌아올 형식을 예시로 보여준다', () => {
    expect(p).toContain('[답변]');
    expect(p).toContain('Q1:');
    expect(p).toContain('Q3 의견:');
  });

  it('보기 없는 질문에는 알파벳 줄을 만들지 않는다', () => {
    expect(p).not.toContain('Q3: A');
    expect(p).toContain('보기 없음');
  });

  it('첫 턴이면 정해진 게 없다고 말한다', () => {
    expect(buildConsultPrompt(createEmptyState(''), QS)).toContain('아직 아무것도 정해지지 않았습니다');
  });

  it('긴 섹션은 잘라서 붙여넣기가 감당하게 한다', () => {
    const s = createEmptyState('긴 문서');
    s.sections.S2 = { ...s.sections.S2, content: '가'.repeat(2000), status: 'drafting' };
    expect(buildConsultPrompt(s, QS)).toContain('…');
    expect(buildConsultPrompt(s, QS).length).toBeLessThan(6000);
  });
});

describe('돌아온 답 읽기 — 형식을 지킨 경우', () => {
  it('예시 그대로면 전부 읽는다', () => {
    const r = parseConsultReply(`[답변]
Q1: A
Q1 의견: 서버가 없어야 유지비가 0이다
Q2: B
Q2 의견: 대신 차단이 아니라 고지로
Q3 의견: 주당 10시간, 3~4주`, QS);

    expect(r.answers).toEqual([
      { questionId: 'Q1', choice: 'A', note: '서버가 없어야 유지비가 0이다' },
      { questionId: 'Q2', choice: 'B', note: '대신 차단이 아니라 고지로' },
      { questionId: 'Q3', choice: null, note: '주당 10시간, 3~4주' },
    ]);
    expect(r.ignored).toEqual([]);
  });
});

describe('돌아온 답 읽기 — 형식이 어긋난 경우', () => {
  it('앞뒤 잡담이 붙어 있어도 답변만 건진다', () => {
    const r = parseConsultReply(`좋은 질문이네요! 하나씩 볼게요.

정적 호스팅이 맞다고 봅니다.

[답변]
Q1: A
Q3 의견: 0원

도움이 되셨길 바랍니다.`, QS);
    expect(r.answers.map((a) => a.questionId)).toEqual(['Q1', 'Q3']);
    expect(r.answers[0]!.choice).toBe('A');
  });

  it('알파벳 뒤에 보기 이름을 붙여도 읽는다', () => {
    const r = parseConsultReply('Q1: B) 서버 포함', QS);
    expect(r.answers[0]).toEqual({ questionId: 'Q1', choice: 'B', note: '서버 포함' });
  });

  it('여러 표기법을 받는다 — 형식을 외우게 하지 않는다', () => {
    for (const line of ['Q1: A', 'q1. A', '1) A', '질문 1: A', '- Q1: A', '**Q1:** A']) {
      const r = parseConsultReply(line, QS);
      expect(r.answers[0]?.choice, line).toBe('A');
    }
  });

  it('"선택:" 접두를 붙여도 읽는다', () => {
    expect(parseConsultReply('Q2: 선택: B', QS).answers[0]!.choice).toBe('B');
  });

  it('여러 줄에 걸친 의견을 이어붙인다', () => {
    const r = parseConsultReply(`Q1 의견: 서버를 두지 않는다.
그래야 유지비가 0이 된다.
- 배포는 정적 호스팅으로.`, QS);
    expect(r.answers[0]!.note).toBe('서버를 두지 않는다. 그래야 유지비가 0이 된다. 배포는 정적 호스팅으로.');
  });

  it('코드 울타리와 구분선은 의견에 섞이지 않는다', () => {
    const r = parseConsultReply('```\n[답변]\nQ1: A\n```\n---', QS);
    expect(r.answers[0]).toEqual({ questionId: 'Q1', choice: 'A', note: '' });
  });

  it('없는 질문 번호는 버리되 무엇을 버렸는지 알린다', () => {
    const r = parseConsultReply('Q1: A\nQ9: B', QS);
    expect(r.answers).toHaveLength(1);
    expect(r.ignored).toEqual(['Q9']);
  });

  it('보기에 없는 알파벳은 선택으로 치지 않고 의견으로 남긴다', () => {
    const r = parseConsultReply('Q1: Z 잘 모르겠습니다', QS);
    expect(r.answers[0]!.choice).toBeNull();
    expect(r.answers[0]!.note).toContain('잘 모르겠습니다');
  });

  it('알파벳을 비우고 의견만 적어도 읽는다', () => {
    const r = parseConsultReply('Q1 의견: 보기가 다 안 맞습니다', QS);
    expect(r.answers[0]).toEqual({ questionId: 'Q1', choice: null, note: '보기가 다 안 맞습니다' });
  });

  it('빈 답으로 카드를 덮지 않는다', () => {
    expect(parseConsultReply('Q1:', QS).answers).toEqual([]);
    expect(parseConsultReply('', QS).answers).toEqual([]);
  });

  it('아무 관계 없는 글을 넣어도 죽지 않는다', () => {
    expect(() => parseConsultReply('안녕하세요\n오늘 날씨가 좋네요', QS)).not.toThrow();
    expect(parseConsultReply('안녕하세요', QS).answers).toEqual([]);
  });
});

describe('기존 답과 합치기', () => {
  it('읽은 것만 덮고 나머지는 남긴다', () => {
    const cur: AnswerMap = {
      Q1: { choice: 'B', note: '내가 손으로 적은 것' },
      Q2: { choice: null, note: '이건 지키고 싶다' },
    };
    const next = mergeAnswers(cur, [{ questionId: 'Q1', choice: 'A', note: 'AI가 준 것' }]);
    expect(next.Q1).toEqual({ choice: 'A', note: 'AI가 준 것' });
    expect(next.Q2).toEqual({ choice: null, note: '이건 지키고 싶다' });
  });

  it('원본을 변형하지 않는다', () => {
    const cur: AnswerMap = { Q1: { choice: 'B', note: '' } };
    mergeAnswers(cur, [{ questionId: 'Q1', choice: 'A', note: 'x' }]);
    expect(cur.Q1!.choice).toBe('B');
  });
});
