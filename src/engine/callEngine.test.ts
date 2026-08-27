import { describe, it, expect } from 'vitest';
import { callEngine, runTurn } from './callEngine.js';
import { buildTurnPrompt, recentHistory, trimHistory } from './prompt.js';
import { stripCodeFence, toPatches } from './geminiAdapter.js';
import { createEmptyState, type PRDState } from '../types/prd.js';
import { editSection } from './applyPatches.js';

// --- 가짜 API ---------------------------------------------------------------

/** Gemini 응답 본문 한 건을 만든다 */
function geminiBody(payload: unknown, usage: Record<string, number> = {}) {
  return {
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text: JSON.stringify(payload) }] } }],
    usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50, thoughtsTokenCount: 20, ...usage },
  };
}

/** 호출마다 다른 응답을 내주는 가짜 fetch. 요청 본문도 기록한다. */
function fakeFetch(responses: Array<Response | (() => Response)>) {
  const calls: any[] = [];
  const impl = (async (_url: string, init: RequestInit) => {
    calls.push(JSON.parse(String(init.body)));
    const next = responses[Math.min(calls.length - 1, responses.length - 1)]!;
    return typeof next === 'function' ? next() : next;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const ok = (payload: unknown, usage?: Record<string, number>) =>
  new Response(JSON.stringify(geminiBody(payload, usage)), { status: 200 });
const status = (code: number, body = '{}') => new Response(body, { status: code });
const rawText = (text: string) =>
  new Response(JSON.stringify({
    candidates: [{ finishReason: 'STOP', content: { parts: [{ text }] } }],
    usageMetadata: {},
  }), { status: 200 });

const GOOD = {
  reply: '예산부터 확정합시다. 1) 얼마입니까?',
  setSections: [{ id: 'S0', content: '### S0\n- 예산: 미정', status: 'drafting' }],
  addOpenQuestions: ['예산 한도'],
  addUnverified: [],
  nextFocus: 'S0',
};

const deps = (fetchImpl: typeof fetch) => ({
  apiKey: 'test-key',
  fetchImpl,
  sleep: async () => {},
});

// --- FR-002 프롬프트 조립 ---------------------------------------------------

describe('프롬프트 조립 — FR-002', () => {
  it('최근 6턴만 포함한다', () => {
    const s = createEmptyState();
    s.history = Array.from({ length: 40 }, (_, i) => ({
      turn: i, role: 'user' as const, text: `발화${i}`,
    }));
    const p = buildTurnPrompt(s, '최신 입력');
    expect(recentHistory(s.history)).toHaveLength(6);
    expect(p).toContain('발화39');
    expect(p).not.toContain('발화33');
  });

  it('confirmed 섹션 content가 전부 들어간다', () => {
    const s = createEmptyState();
    s.sections.S1.content = '고유한내용ALPHA';
    s.sections.S1.status = 'confirmed';
    s.sections.S8.content = '고유한내용BETA';
    s.sections.S8.status = 'confirmed';
    const p = buildTurnPrompt(s, 'x');
    expect(p).toContain('고유한내용ALPHA');
    expect(p).toContain('고유한내용BETA');
  });

  it('30턴 이상 뒤에도 초반 확정 섹션이 유실되지 않는다 — AC3', () => {
    const s = createEmptyState();
    s.sections.S0.content = '초반에확정된내용GAMMA';
    s.sections.S0.status = 'confirmed';
    s.sections.S0.updatedAtTurn = 1;
    s.turn = 35;
    s.history = Array.from({ length: 70 }, (_, i) => ({
      turn: i, role: 'user' as const, text: `발화${i}`,
    }));
    expect(buildTurnPrompt(s, 'x')).toContain('초반에확정된내용GAMMA');
  });

  it('history는 상태 JSON 블록에 통째로 실리지 않는다', () => {
    const s = createEmptyState();
    s.history = [{ turn: 1, role: 'user', text: '오래된발화ZETA' }];
    const json = buildTurnPrompt(s, 'x').split('## 직전 대화')[0]!;
    expect(json).not.toContain('오래된발화ZETA');
  });

  it('trimHistory는 오래된 것부터 버리고 섹션은 건드리지 않는다 — §11', () => {
    const s = createEmptyState();
    s.sections.S1.content = '보존되어야함';
    s.history = Array.from({ length: 10 }, (_, i) => ({ turn: i, role: 'user' as const, text: `t${i}` }));
    const t = trimHistory(s, 3);
    expect(t.history.map((h) => h.text)).toEqual(['t7', 't8', 't9']);
    expect(t.sections.S1.content).toBe('보존되어야함');
  });
});

// --- FR-004 스키마 위반 복구 ------------------------------------------------

describe('파싱 — FR-004', () => {
  it('코드펜스를 벗겨낸다', () => {
    expect(stripCodeFence('```json\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('```\n{"a":1}\n```')).toBe('{"a":1}');
    expect(stripCodeFence('{"a":1}')).toBe('{"a":1}');
  });

  it('코드펜스가 붙어 와도 정상 처리한다', async () => {
    const f = fakeFetch([rawText('```json\n' + JSON.stringify(GOOD) + '\n```')]);
    const r = await callEngine(createEmptyState(), '입력', deps(f.impl));
    expect(r.ok).toBe(true);
  });

  it('파싱 실패 시 스키마 위반을 알리며 재요청한다', async () => {
    const f = fakeFetch([rawText('이건 JSON이 아닙니다'), rawText('여전히 아님'), ok(GOOD)]);
    const r = await callEngine(createEmptyState(), '입력', deps(f.impl));

    expect(r.ok).toBe(true);
    expect(f.calls).toHaveLength(3);
    // 2·3회차 요청에는 위반 안내가 덧붙는다
    expect(f.calls[0].contents[0].parts).toHaveLength(1);
    expect(f.calls[1].contents[0].parts[1].text).toContain('스키마를 위반했다');
  });

  it('3회 실패하면 포기하고 안내 메시지를 낸다', async () => {
    const f = fakeFetch([rawText('nope')]);
    const r = await callEngine(createEmptyState(), '입력', deps(f.impl));

    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('schema');
      expect(r.error.message).toBe('엔진 응답 오류, 다시 시도해주세요.');
    }
    expect(f.calls).toHaveLength(3);
  });

  it('3회 실패해도 상태를 변경하지 않는다 — AC3', async () => {
    const f = fakeFetch([rawText('nope')]);
    const before = createEmptyState('원본');
    const r = await runTurn(before, '입력', deps(f.impl));

    expect(r.ok).toBe(false);
    expect(r.state).toEqual(before);
  });
});

// --- NFR-004 에러 구분 ------------------------------------------------------

describe('에러 구분 — NFR-004', () => {
  it.each([
    [401, 'auth'],
    [403, 'auth'],
  ])('HTTP %i → %s, 재시도하지 않는다', async (code, kind) => {
    const f = fakeFetch([status(code)]);
    const r = await callEngine(createEmptyState(), 'x', deps(f.impl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe(kind);
    expect(f.calls).toHaveLength(1);
  });

  it('네트워크 실패는 즉시 알린다', async () => {
    const impl = (async () => { throw new TypeError('failed to fetch'); }) as unknown as typeof fetch;
    const r = await callEngine(createEmptyState(), 'x', deps(impl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('network');
  });

  it('429는 지수 백오프로 재시도한다 — §11', async () => {
    const f = fakeFetch([status(429), status(429), ok(GOOD)]);
    const waits: number[] = [];
    const r = await callEngine(createEmptyState(), 'x', {
      apiKey: 'k', fetchImpl: f.impl, sleep: async (ms) => { waits.push(ms); },
    });
    expect(r.ok).toBe(true);
    expect(waits).toEqual([1000, 2000]);
  });

  it('429가 계속되면 4회 시도 후 포기한다', async () => {
    const f = fakeFetch([status(429)]);
    const r = await callEngine(createEmptyState(), 'x', deps(f.impl));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('rate_limit');
    expect(f.calls).toHaveLength(4);
  });

  it('5xx도 백오프 재시도 후 복구된다', async () => {
    const f = fakeFetch([status(503), ok(GOOD)]);
    const r = await callEngine(createEmptyState(), 'x', deps(f.impl));
    expect(r.ok).toBe(true);
  });

  it('본문 없는 응답은 blocked로 잡고 재시도한다', async () => {
    const f = fakeFetch([
      new Response(JSON.stringify({ candidates: [{ finishReason: 'SAFETY' }] }), { status: 200 }),
      ok(GOOD),
    ]);
    const r = await callEngine(createEmptyState(), 'x', deps(f.impl));
    expect(r.ok).toBe(true);
  });
});

// --- 벤더 형식 → 정규 Patch[] ----------------------------------------------

describe('toPatches', () => {
  it('op별 배열을 정규 Patch[]로 변환한다', () => {
    const patches = toPatches({
      setSections: [{ id: 'S1', content: 'c', status: 'confirmed' }],
      addOpenQuestions: ['q'],
      addUnverified: ['GPT-4'],
      addCostLines: [{ item: 'i', unit: 'u', estimatedCost: 1, verified: true, note: '' }],
      addRequirements: [{ id: 'FR-001', title: 't', description: 'd', acceptanceCriteria: ['a', 'b'], priority: 'Must', dependsOn: [], section: 'FR' }],
    });
    expect(patches.map((p) => p.op)).toEqual([
      'set_section', 'add_requirement', 'add_open_question', 'add_cost_line', 'add_unverified',
    ]);
  });

  it('지어낸 섹션 ID는 버린다', () => {
    const patches = toPatches({ setSections: [{ id: 'overview', content: 'c', status: 'drafting' }] });
    expect(patches).toHaveLength(0);
  });

  it('배열이 없어도 죽지 않는다', () => {
    expect(toPatches({ reply: 'x' })).toEqual([]);
  });
});

// --- 한 턴 왕복 -------------------------------------------------------------

describe('runTurn', () => {
  it('상태를 갱신하고 검증기를 재실행한다', async () => {
    const f = fakeFetch([ok(GOOD)]);
    const r = await runTurn(createEmptyState(), '할 일 앱 만들래요', deps(f.impl));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.turn).toBe(1);
    expect(r.state.sections.S0.content).toContain('예산');
    expect(r.state.sections.S0.status).toBe('drafting');
    expect(r.state.openQuestions).toEqual(['예산 한도']);
    expect(r.reply).toContain('예산');
    expect(r.issues.some((i) => i.severity === 'block')).toBe(true); // 아직 미완성
    expect(r.usage.inputTokens).toBe(100);
  });

  it('대화 이력에 사용자·엔진 발화가 쌓인다', async () => {
    const f = fakeFetch([ok(GOOD)]);
    const r = await runTurn(createEmptyState(), '내 입력', deps(f.impl));
    if (!r.ok) throw new Error('실패');
    expect(r.state.history.map((h) => h.role)).toEqual(['user', 'engine']);
    expect(r.state.history[0]!.text).toBe('내 입력');
  });

  it('잠긴 섹션은 보호되고 거부 목록에 담긴다 — §13 Q2', async () => {
    const f = fakeFetch([ok(GOOD)]);
    const locked = editSection(createEmptyState(), 'S0', '내가 쓴 S0');
    const r = await runTurn(locked, 'x', deps(f.impl));

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.sections.S0.content).toBe('내가 쓴 S0');
    expect(r.rejected.map((x) => x.reason)).toContain('section_locked');
  });

  it('입력 상태를 변형하지 않는다', async () => {
    const f = fakeFetch([ok(GOOD)]);
    const before: PRDState = createEmptyState();
    const snapshot = JSON.parse(JSON.stringify(before));
    await runTurn(before, 'x', deps(f.impl));
    expect(before).toEqual(snapshot);
  });
});
