// 엔진 호출 격리 계층 — 스펙 §9 "UI는 callEngine 하나만 안다".
//
// 재시도 정책:
// - 스키마 위반 → 위반을 알리며 최대 2회 재요청 (FR-004). 총 3회 실패 시 상태 불변.
// - 429/5xx    → 지수 백오프 3회 (스펙 §11).
// - 네트워크/키 오류 → 재시도하지 않고 즉시 사용자에게 알린다 (NFR-004).

import { MAX_RATE_LIMIT_RETRIES, MAX_SCHEMA_RETRIES } from '../config.js';
import type { PRDState } from '../types/prd.js';
import { applyPatches, type RejectedPatch } from './applyPatches.js';
import {
  EngineFailure,
  callGemini,
  type EngineError,
  type EngineUsage,
  type RawEngineResponse,
} from './geminiAdapter.js';
import { buildTurnPrompt } from './prompt.js';
import type { EngineQuestion } from './question.js';
import { SCHEMA_VIOLATION_REMINDER, SYSTEM_PROMPT } from './systemPrompt.js';
import { validate, type ValidationIssue } from '../validator/validate.js';

export interface EngineDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
  modelId?: string;
  signal?: AbortSignal;
  /** 테스트에서 백오프를 건너뛰기 위해 주입한다. */
  sleep?: (ms: number) => Promise<void>;
}

export type EngineResult =
  | ({ ok: true } & RawEngineResponse)
  | { ok: false; error: EngineError };

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function isEngineFailure(e: unknown): e is EngineFailure {
  return e instanceof EngineFailure;
}

/**
 * 한 턴을 호출하고 파싱까지 마친다. 상태는 건드리지 않는다.
 * 실패하면 사유를 구분해 돌려준다 — NFR-004.
 */
export async function callEngine(
  state: PRDState,
  userInput: string,
  deps: EngineDeps,
): Promise<EngineResult> {
  const sleep = deps.sleep ?? defaultSleep;
  const basePrompt = buildTurnPrompt(state, userInput);

  let schemaAttempts = 0;
  let rateLimitAttempts = 0;
  let lastError: EngineError = { kind: 'unknown', message: '엔진을 호출하지 못했습니다.' };

  // 재시도마다 스키마 위반 안내가 누적되지 않도록, 위반 시에만 한 번 덧붙인다.
  for (;;) {
    const userParts = schemaAttempts > 0
      ? [basePrompt, SCHEMA_VIOLATION_REMINDER]
      : [basePrompt];

    try {
      const raw = await callGemini({
        apiKey: deps.apiKey,
        systemPrompt: SYSTEM_PROMPT,
        userParts,
        fetchImpl: deps.fetchImpl,
        modelId: deps.modelId,
        signal: deps.signal,
      });
      return { ok: true, ...raw };
    } catch (e) {
      if (!isEngineFailure(e)) throw e;
      lastError = e.error;

      if (e.error.kind === 'schema' || e.error.kind === 'blocked') {
        if (schemaAttempts >= MAX_SCHEMA_RETRIES) {
          return {
            ok: false,
            error: { kind: 'schema', message: '엔진 응답 오류, 다시 시도해주세요.' },
          };
        }
        schemaAttempts += 1;
        continue;
      }

      if (e.error.kind === 'rate_limit' || e.error.kind === 'server') {
        if (rateLimitAttempts >= MAX_RATE_LIMIT_RETRIES) return { ok: false, error: lastError };
        await sleep(2 ** rateLimitAttempts * 1000);
        rateLimitAttempts += 1;
        continue;
      }

      // network, auth, unknown — 재시도해도 달라지지 않는다
      return { ok: false, error: lastError };
    }
  }
}

// --- 한 턴 왕복 -------------------------------------------------------------

export interface TurnSuccess {
  ok: true;
  state: PRDState;
  reply: string;
  /** FR-014 객관식 질문 카드 */
  questions: EngineQuestion[];
  issues: ValidationIssue[];
  /** 적용되지 않은 패치. 잠긴 섹션 등 — UI가 사용자에게 알린다. */
  rejected: RejectedPatch[];
  usage: EngineUsage;
}

export type TurnResult = TurnSuccess | { ok: false; error: EngineError; state: PRDState };

/**
 * 사용자 입력 한 건을 받아 상태를 갱신하고 검증기를 재실행한다 — 스펙 §5.3.
 * 실패 시 **상태를 변경하지 않는다** (FR-004 AC3).
 */
export async function runTurn(
  state: PRDState,
  userInput: string,
  deps: EngineDeps,
): Promise<TurnResult> {
  const result = await callEngine(state, userInput, deps);
  if (!result.ok) return { ok: false, error: result.error, state };

  const turn = state.turn + 1;
  const withTurn: PRDState = {
    ...state,
    turn,
    history: [
      ...state.history,
      { turn, role: 'user', text: userInput },
      { turn, role: 'engine', text: result.reply },
    ],
  };

  const { state: next, rejected } = applyPatches(withTurn, result.patches);

  return {
    ok: true,
    state: next,
    reply: result.reply,
    questions: result.questions,
    issues: validate(next),
    rejected,
    usage: result.usage,
  };
}
