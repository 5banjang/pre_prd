import { describe, it, expect } from 'vitest';
import {
  APIKEY_KEY,
  CURRENT_SCHEMA,
  EMPTY_SESSION,
  SESSION_KEY,
  STATE_KEY,
  clearApiKey,
  clearSession,
  loadSession,
  memoryStore,
  migrate,
  parseStateFile,
  saveApiKey,
  saveSessionMeta,
  saveState,
  serializeState,
  stateFileName,
  type KV,
} from './persist.js';
import { createEmptyState } from '../types/prd.js';

function sample() {
  const s = createEmptyState('러닝 크루 앱');
  s.turn = 7;
  s.sections.S0.content = 'S0 본문';
  s.sections.S0.status = 'confirmed';
  s.sections.S4.locked = true;
  s.openQuestions = ['예산'];
  s.history = [{ turn: 1, role: 'user', text: '안녕' }];
  return s;
}

/** 항상 터지는 저장소 — 브라우저가 저장을 거부하는 상황 */
const brokenStore = (): KV => ({
  async get() { throw new Error('QuotaExceeded'); },
  async set() { throw new Error('QuotaExceeded'); },
  async del() { throw new Error('QuotaExceeded'); },
});

// --- FR-010 AC3 파일 입출력 -------------------------------------------------

describe('직렬화 왕복', () => {
  it('내보낸 파일을 그대로 다시 읽는다', () => {
    const s = sample();
    const r = parseStateFile(serializeState(s));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state).toEqual(s);
  });

  it('파일명에 프로젝트명과 턴 수가 들어간다', () => {
    expect(stateFileName(sample())).toBe('러닝-크루-앱-turn7.state.json');
  });

  it('프로젝트명이 없어도 이름을 만든다', () => {
    expect(stateFileName(createEmptyState())).toBe('prd-turn0.state.json');
  });
});

describe('parseStateFile — 신뢰할 수 없는 입력', () => {
  it('JSON이 아니면 사유를 돌려준다', () => {
    const r = parseStateFile('이건 그냥 텍스트');
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('JSON');
  });

  it.each(['null', '"문자열"', '[1,2,3]', '42'])('객체가 아닌 %s를 거부한다', (t) => {
    expect(parseStateFile(t).ok).toBe(false);
  });

  it('미래 버전은 거부하고 업데이트를 안내한다', () => {
    const r = parseStateFile(JSON.stringify({ schemaVersion: 99 }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toContain('업데이트');
  });
});

describe('migrate — 옛 데이터 이행', () => {
  it('schemaVersion이 없으면 경고와 함께 살린다', () => {
    const r = migrate({ projectName: '옛 문서', sections: {} });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.schemaVersion).toBe(CURRENT_SCHEMA);
    expect(r.state.projectName).toBe('옛 문서');
    expect(r.warnings.join()).toContain('스키마 버전');
  });

  it('v1에서 추가된 locked가 없으면 false로 채운다', () => {
    const r = migrate({ sections: { S0: { status: 'confirmed', content: 'x' } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.sections.S0.locked).toBe(false);
  });

  it('모르는 섹션 ID는 버린다', () => {
    const r = migrate({ sections: { S0: { content: 'ok' }, S99: { content: '무효' } } });
    expect(r.ok).toBe(true);
    if (r.ok) expect(Object.keys(r.state.sections)).toHaveLength(12);
  });

  it('잘못된 status는 empty로 되돌린다', () => {
    const r = migrate({ sections: { S0: { status: '아무거나', content: 'x' } } });
    if (r.ok) expect(r.state.sections.S0.status).toBe('empty');
  });

  it('배열 필드가 오염돼 있으면 유효한 항목만 남긴다', () => {
    const r = migrate({
      openQuestions: ['정상', 42, null],
      requirements: [{ id: 'FR-001' }, '쓰레기'],
      history: [{ text: '정상' }, 5],
    });
    if (!r.ok) throw new Error('실패');
    expect(r.state.openQuestions).toEqual(['정상']);
    expect(r.state.requirements).toHaveLength(1);
    expect(r.state.history).toHaveLength(1);
  });

  it('음수 턴은 0으로 되돌린다', () => {
    const r = migrate({ turn: -5 });
    if (r.ok) expect(r.state.turn).toBe(0);
  });
});

// --- FR-010 AC1·AC2 저장·복구 -----------------------------------------------

describe('세션 저장·복구', () => {
  it('저장한 상태를 새로고침 후 복구한다', async () => {
    const kv = memoryStore();
    const s = sample();
    expect(await saveState(kv, s)).toBe(true);

    const loaded = await loadSession(kv);
    expect(loaded.state).toEqual(s);
    expect(loaded.warnings).toEqual([]);
  });

  it('잠금 상태가 보존된다 — §13 Q2', async () => {
    const kv = memoryStore();
    await saveState(kv, sample());
    const loaded = await loadSession(kv);
    expect(loaded.state?.sections.S4.locked).toBe(true);
  });

  it('저장된 것이 없으면 null을 준다 (새 세션)', async () => {
    const loaded = await loadSession(memoryStore());
    expect(loaded.state).toBeNull();
    expect(loaded.apiKey).toBe('');
  });

  it('저장된 데이터가 깨져 있어도 앱이 뜬다', async () => {
    const loaded = await loadSession(memoryStore({ [STATE_KEY]: '깨진 데이터' }));
    expect(loaded.state).toBeNull();
    expect(loaded.warnings.join()).toContain('불러오지 못했습니다');
  });

  it('저장소 자체가 터져도 앱이 뜬다', async () => {
    const loaded = await loadSession(brokenStore());
    expect(loaded.state).toBeNull();
    expect(loaded.warnings.join()).toContain('저장소를 읽지 못했습니다');
  });

  it('저장 실패는 false를 돌려주되 예외를 던지지 않는다', async () => {
    await expect(saveState(brokenStore(), sample())).resolves.toBe(false);
  });

  it('세션 초기화가 저장분을 지운다', async () => {
    const kv = memoryStore();
    await saveState(kv, sample());
    await clearSession(kv);
    expect((await loadSession(kv)).state).toBeNull();
  });
});

// --- FR-011 키 관리 ----------------------------------------------------------

describe('API 키 — FR-011', () => {
  it('저장하고 복구한다', async () => {
    const kv = memoryStore();
    await saveApiKey(kv, 'my-key');
    expect((await loadSession(kv)).apiKey).toBe('my-key');
  });

  it('빈 문자열을 저장하면 지운다', async () => {
    const kv = memoryStore({ [APIKEY_KEY]: 'old' });
    await saveApiKey(kv, '');
    expect((await loadSession(kv)).apiKey).toBe('');
  });

  it('삭제가 동작한다 — AC3', async () => {
    const kv = memoryStore({ [APIKEY_KEY]: 'old' });
    await clearApiKey(kv);
    expect((await loadSession(kv)).apiKey).toBe('');
  });

  it('키가 문자열이 아니면 무시한다', async () => {
    expect((await loadSession(memoryStore({ [APIKEY_KEY]: { a: 1 } }))).apiKey).toBe('');
  });

  it('저장소가 터져도 예외를 던지지 않는다', async () => {
    await expect(saveApiKey(brokenStore(), 'k')).resolves.toBeUndefined();
    await expect(clearApiKey(brokenStore())).resolves.toBeUndefined();
  });

  it('세션 상태와 키는 별도로 지워진다', async () => {
    const kv = memoryStore();
    await saveState(kv, sample());
    await saveApiKey(kv, 'k');
    await clearSession(kv);

    const loaded = await loadSession(kv);
    expect(loaded.state).toBeNull();
    expect(loaded.apiKey).toBe('k'); // 세션만 지웠으므로 키는 남는다
  });
});

// --- 세션 메타 (누적 비용 · 답하다 만 카드) ---------------------------------

describe('SessionMeta — FR-012 AC3 / FR-014', () => {
  it('누적 토큰이 새로고침에 살아남는다', async () => {
    const kv = memoryStore();
    await saveSessionMeta(kv, {
      inputTokens: 1769, outputTokens: 585, nudged: true, questions: [],
    });
    const loaded = await loadSession(kv);
    expect(loaded.meta.inputTokens).toBe(1769);
    expect(loaded.meta.outputTokens).toBe(585);
    expect(loaded.meta.nudged).toBe(true);
  });

  it('답하다 만 질문 카드가 살아남는다', async () => {
    const kv = memoryStore();
    const q = { id: 'Q1', text: '예산은?', options: [] };
    await saveSessionMeta(kv, { ...EMPTY_SESSION, questions: [q] });
    expect((await loadSession(kv)).meta.questions).toEqual([q]);
  });

  it('메타가 없으면 0에서 시작한다', async () => {
    expect((await loadSession(memoryStore())).meta).toEqual(EMPTY_SESSION);
  });

  it('메타가 오염돼 있어도 안전한 값으로 되돌린다', async () => {
    const kv = memoryStore({
      [SESSION_KEY]: { inputTokens: -5, outputTokens: 'many', nudged: 'yes', questions: 'nope' },
    });
    expect((await loadSession(kv)).meta).toEqual(EMPTY_SESSION);
  });

  it('새 세션 시작은 상태와 메타를 함께 지운다', async () => {
    const kv = memoryStore();
    await saveState(kv, sample());
    await saveSessionMeta(kv, { ...EMPTY_SESSION, inputTokens: 999 });
    await clearSession(kv);

    const loaded = await loadSession(kv);
    expect(loaded.state).toBeNull();
    expect(loaded.meta.inputTokens).toBe(0);
  });
});

describe('[미검증] 청소 — 빌더 지적 2026-09-03', () => {
  it('불러오면서 확인할 주장이 없는 이름을 걷어낸다', () => {
    const raw = { ...createEmptyState('청소'), unverifiedTerms: [
      'IndexedDB', 'GitHub Pages', 'Zod',
      'Gemini 3.7 Flash $0.75/1M', 'Vercel 무료 티어',
    ] };
    const r = migrate(raw);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.unverifiedTerms).toEqual(['Gemini 3.7 Flash $0.75/1M', 'Vercel 무료 티어']);
  });
});
