import { describe, it, expect } from 'vitest';
import { MAX_HISTORY_TURNS } from '../config.js';
import { buildTurnPrompt, recentHistory, stateForPrompt, trimHistory } from './prompt.js';
import { SYSTEM_PROMPT } from './systemPrompt.js';
import { createEmptyState, type HistoryEntry, type PRDState } from '../types/prd.js';

function withHistory(n: number): PRDState {
  const s = createEmptyState('테스트');
  const history: HistoryEntry[] = [];
  for (let i = 1; i <= n; i += 1) {
    history.push({ turn: i, role: 'user', text: `사용자 발화 ${i}` });
    history.push({ turn: i, role: 'engine', text: `엔진 응답 ${i}` });
  }
  return { ...s, history, turn: n };
}

describe('상태 JSON', () => {
  it('history를 상태 블록에 싣지 않는다 — 이력을 두 번 싣지 않는다 (§5.1)', () => {
    const s = withHistory(3);
    expect('history' in stateForPrompt(s)).toBe(false);
  });

  it('섹션 content는 그대로 실린다 — 그것이 문서의 본체다', () => {
    const s = createEmptyState('테스트');
    s.sections.S2.content = '만들 것의 목록';
    expect(buildTurnPrompt(s, '입력')).toContain('만들 것의 목록');
  });
});

describe('직전 대화 창', () => {
  it('최근 N턴만 잘라낸다', () => {
    expect(recentHistory(withHistory(10).history)).toHaveLength(MAX_HISTORY_TURNS);
  });

  it('잘린 것이 없으면 생략 안내를 붙이지 않는다', () => {
    const p = buildTurnPrompt(withHistory(1), '입력');
    expect(p).not.toContain('실리지 않았다');
    expect(p).toContain('사용자 발화 1');
  });

  // M7 회귀: 엔진이 창 밖의 발화를 "원문 인용"이라며 지어냈다.
  it('잘린 이력이 있으면 그 사실과 개수를 엔진에게 알린다', () => {
    const s = withHistory(20);
    const p = buildTurnPrompt(s, '턴 1에서 내가 한 말을 그대로 인용해봐라');
    const omitted = s.history.length - MAX_HISTORY_TURNS;

    expect(p).toContain(`앞선 ${omitted}턴은 이 프롬프트에 실리지 않았다`);
    expect(p).toContain('원문을 지어내지 마라');
    // 실제로 잘려 있어야 안내가 참이 된다
    expect(p).not.toContain('사용자 발화 1\n');
  });

  it('첫 턴은 이전 대화 없음으로 표시한다', () => {
    expect(buildTurnPrompt(createEmptyState(''), '첫 입력')).toContain('이번이 첫 턴이다');
  });
});

describe('시스템 지침', () => {
  it('컨텍스트 밖 발화를 인용하지 말라는 규칙이 있다', () => {
    expect(SYSTEM_PROMPT).toContain('프롬프트에 실린 대화만 인용할 수 있다');
    expect(SYSTEM_PROMPT).toContain('컨텍스트에 없다고 답하고');
  });
});

describe('trimHistory', () => {
  it('한계에 닿으면 오래된 것부터 버리되 섹션은 건드리지 않는다 — §11', () => {
    const s = withHistory(10);
    s.sections.S1.content = '지켜져야 할 본문';
    const t = trimHistory(s, 4);
    expect(t.history).toHaveLength(4);
    expect(t.history.at(-1)).toEqual(s.history.at(-1));
    expect(t.sections.S1.content).toBe('지켜져야 할 본문');
  });

  it('한계 이하면 그대로 둔다', () => {
    const s = withHistory(2);
    expect(trimHistory(s, 100)).toBe(s);
  });
});
