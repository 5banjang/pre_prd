// 영속화 — FR-010(세션 저장·복구·파일 입출력) + FR-011(BYOK 키 관리).
//
// 스펙 §9 Suggestion 대로 IndexedDB(idb-keyval)를 쓴다. localStorage는 상태 JSON이
// 커지면 한계가 있다.
//
// 저장소 접근은 KV 인터페이스 뒤에 둔다. 브라우저가 없는 테스트에서 메모리 구현으로 갈아끼운다.

import { createEmptyState, SECTION_IDS, type PRDState, type Section } from '../types/prd.js';

export interface KV {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  del(key: string): Promise<void>;
}

export const STATE_KEY = 'prd-architect:state';
export const APIKEY_KEY = 'prd-architect:apikey';
export const SESSION_KEY = 'prd-architect:session';

/**
 * PRD 문서가 아니라 **세션에 딸린 것들**. PRDState를 오염시키지 않으려고 따로 둔다.
 * 누적 토큰(FR-012 AC3)과 답하다 만 질문 카드(FR-014)가 새로고침에 살아남아야 한다.
 */
export interface SessionMeta {
  inputTokens: number;
  outputTokens: number;
  /** 25턴 안내를 이미 보여줬는가 — FR-012 AC2는 1회 노출을 요구한다 */
  nudged: boolean;
  /** 아직 답하지 않은 질문 카드 */
  questions: unknown[];
}

export const EMPTY_SESSION: SessionMeta = {
  inputTokens: 0, outputTokens: 0, nudged: false, questions: [],
};

function readSessionMeta(raw: unknown): SessionMeta {
  if (!isRecord(raw)) return { ...EMPTY_SESSION };
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
  return {
    inputTokens: num(raw.inputTokens),
    outputTokens: num(raw.outputTokens),
    nudged: raw.nudged === true,
    questions: Array.isArray(raw.questions) ? raw.questions : [],
  };
}

/** 현재 스키마 버전. 올릴 때는 migrate()에 이행 규칙을 추가한다. */
export const CURRENT_SCHEMA = 1;

// --- 파일 입출력 (순수) ------------------------------------------------------

export function serializeState(state: PRDState): string {
  return JSON.stringify(state, null, 2);
}

export type ParseResult =
  | { ok: true; state: PRDState; warnings: string[] }
  | { ok: false; error: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * 저장된 상태를 현재 스키마로 되살린다.
 *
 * 신뢰할 수 없는 입력(사용자가 고른 파일, 옛 브라우저 데이터)을 다루므로
 * 없는 필드는 기본값으로 채우고 모르는 필드는 버린다. 절대 예외를 던지지 않는다.
 */
export function migrate(raw: unknown): ParseResult {
  if (!isRecord(raw)) return { ok: false, error: 'PRD 상태 파일 형식이 아닙니다.' };

  const warnings: string[] = [];
  const base = createEmptyState();

  const version = typeof raw.schemaVersion === 'number' ? raw.schemaVersion : 0;
  if (version === 0) warnings.push('스키마 버전이 없어 초기 형식으로 간주했습니다.');
  if (version > CURRENT_SCHEMA) {
    return { ok: false, error: `더 새로운 형식입니다 (v${version}). 앱을 업데이트해 주세요.` };
  }

  // 섹션 — 알려진 ID만 취하고, 없으면 빈 섹션을 남긴다
  const sections = { ...base.sections };
  if (isRecord(raw.sections)) {
    for (const id of SECTION_IDS) {
      const s = raw.sections[id];
      if (!isRecord(s)) continue;
      const cur = sections[id] as Section;
      sections[id] = {
        ...cur,
        status: s.status === 'confirmed' || s.status === 'drafting' ? s.status : 'empty',
        content: typeof s.content === 'string' ? s.content : '',
        updatedAtTurn: typeof s.updatedAtTurn === 'number' ? s.updatedAtTurn : 0,
        // v1에서 추가된 필드 — 옛 데이터에는 없다
        locked: s.locked === true,
      };
    }
  } else {
    warnings.push('섹션 데이터가 없어 빈 상태로 시작합니다.');
  }

  const arr = <T>(v: unknown, guard: (x: unknown) => boolean): T[] =>
    Array.isArray(v) ? (v.filter(guard) as T[]) : [];

  const state: PRDState = {
    schemaVersion: CURRENT_SCHEMA,
    projectName: typeof raw.projectName === 'string' ? raw.projectName : '',
    version: typeof raw.version === 'string' ? raw.version : base.version,
    turn: typeof raw.turn === 'number' && raw.turn >= 0 ? raw.turn : 0,
    sections,
    requirements: arr(raw.requirements, (r) => isRecord(r) && typeof r.id === 'string'),
    costModel: arr(raw.costModel, (c) => isRecord(c) && typeof c.item === 'string'),
    openQuestions: arr(raw.openQuestions, (q) => typeof q === 'string'),
    assumptions: arr(raw.assumptions, (a) => isRecord(a) && typeof a.text === 'string'),
    unverifiedTerms: arr(raw.unverifiedTerms, (t) => typeof t === 'string'),
    history: arr(raw.history, (h) => isRecord(h) && typeof h.text === 'string'),
  };

  return { ok: true, state, warnings };
}

/** 사용자가 고른 파일을 읽는다 — FR-010 AC3. */
export function parseStateFile(text: string): ParseResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON으로 읽을 수 없는 파일입니다.' };
  }
  return migrate(raw);
}

/** 내보낼 파일명. 프로젝트명과 턴 수를 담아 여러 백업을 구분한다. */
export function stateFileName(state: PRDState): string {
  const slug = (state.projectName.trim() || 'prd')
    .replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${slug}-turn${state.turn}.state.json`;
}

// --- 저장소 -----------------------------------------------------------------

/** 브라우저에서 쓰는 기본 구현. idb-keyval은 접근 시점에만 로드한다. */
export function idbStore(): KV {
  return {
    async get(key) {
      const { get } = await import('idb-keyval');
      return get(key);
    },
    async set(key, value) {
      const { set } = await import('idb-keyval');
      return set(key, value);
    },
    async del(key) {
      const { del } = await import('idb-keyval');
      return del(key);
    },
  };
}

/** 테스트·폴백용. */
export function memoryStore(seed: Record<string, unknown> = {}): KV {
  const m = new Map<string, unknown>(Object.entries(seed));
  return {
    async get(key) { return m.get(key) as never; },
    async set(key, value) { m.set(key, value); },
    async del(key) { m.delete(key); },
  };
}

export interface LoadedSession {
  state: PRDState | null;
  apiKey: string;
  meta: SessionMeta;
  warnings: string[];
}

/** 새로고침 후 복구 — FR-010 AC2. 저장소가 깨져 있어도 앱은 뜬다. */
export async function loadSession(kv: KV): Promise<LoadedSession> {
  const warnings: string[] = [];
  let state: PRDState | null = null;
  let apiKey = '';

  try {
    const raw = await kv.get<unknown>(STATE_KEY);
    if (raw !== undefined) {
      const r = migrate(raw);
      if (r.ok) {
        state = r.state;
        warnings.push(...r.warnings);
      } else {
        warnings.push(`저장된 세션을 불러오지 못했습니다: ${r.error}`);
      }
    }
  } catch {
    warnings.push('브라우저 저장소를 읽지 못했습니다. 새 세션으로 시작합니다.');
  }

  try {
    const k = await kv.get<unknown>(APIKEY_KEY);
    if (typeof k === 'string') apiKey = k;
  } catch {
    // 키를 못 읽어도 진행한다. 사용자가 다시 입력하면 된다.
  }

  let meta = { ...EMPTY_SESSION };
  try {
    meta = readSessionMeta(await kv.get<unknown>(SESSION_KEY));
  } catch {
    // 메타가 없어도 인터뷰는 이어갈 수 있다. 누적 비용만 0부터 다시 센다.
  }

  return { state, apiKey, meta, warnings };
}

export async function saveSessionMeta(kv: KV, meta: SessionMeta): Promise<void> {
  try { await kv.set(SESSION_KEY, meta); } catch { /* 무시 */ }
}

/** 매 턴 종료 시 자동 저장 — FR-010 AC1. 실패해도 진행 중 작업을 막지 않는다. */
export async function saveState(kv: KV, state: PRDState): Promise<boolean> {
  try {
    await kv.set(STATE_KEY, state);
    return true;
  } catch {
    return false;
  }
}

/** 키는 브라우저 로컬에만 둔다 — FR-011 AC1. */
export async function saveApiKey(kv: KV, key: string): Promise<void> {
  try {
    if (key) await kv.set(APIKEY_KEY, key);
    else await kv.del(APIKEY_KEY);
  } catch {
    // 저장 실패해도 이번 세션에서는 메모리의 키로 계속 쓸 수 있다
  }
}

/** 설정 화면의 키 삭제 — FR-011 AC3. */
export async function clearApiKey(kv: KV): Promise<void> {
  try { await kv.del(APIKEY_KEY); } catch { /* 무시 */ }
}

export async function clearSession(kv: KV): Promise<void> {
  try { await kv.del(STATE_KEY); } catch { /* 무시 */ }
  try { await kv.del(SESSION_KEY); } catch { /* 무시 */ }
}
