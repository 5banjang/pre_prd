// Gemini 어댑터 — 스펙 §9.
//
// 벤더 고유 형식을 §5.2의 정규 Patch[]로 변환한다. 앱 내부 계약은 §5.2 그대로다.
//
// 실측(2026-08-27)으로 확정한 설계:
// - id·nextFocus에 SectionId enum을 건다. 없으면 모델이 "overview" 같은 어휘를 지어낸다.
// - op별로 배열을 분리한다. Gemini responseSchema는 oneOf를 지원하지 않아,
//   단일 patches 배열로는 op별 필수 필드를 강제할 수 없다.

import { API_BASE, ENGINE_MODEL, THINKING_BUDGET } from '../config.js';
import { SECTION_IDS, type SectionId } from '../types/prd.js';
import type { Patch } from './patch.js';
import type { AnswerOption, EngineQuestion } from './question.js';

export interface EngineUsage {
  inputTokens: number;
  outputTokens: number;
  thinkingTokens: number;
}

export type EngineErrorKind =
  | 'network'      // 연결 실패
  | 'auth'         // 401/403 — 키 오류
  | 'rate_limit'   // 429
  | 'server'       // 5xx
  | 'schema'       // 파싱 실패 또는 스키마 위반
  | 'blocked'      // 안전 필터 등으로 응답이 끊김
  | 'unknown';

export interface EngineError {
  kind: EngineErrorKind;
  message: string;
  status?: number;
}

export interface RawEngineResponse {
  reply: string;
  patches: Patch[];
  /** FR-014 객관식 질문 카드. 최대 3개. 없으면 빈 배열. */
  questions: EngineQuestion[];
  nextFocus: SectionId | null;
  usage: EngineUsage;
}

/** 스키마를 어긴 질문은 버린다. 카드가 안 뜰 뿐 앱은 계속 돈다. */
export function toQuestions(parsed: Record<string, unknown>): EngineQuestion[] {
  if (!Array.isArray(parsed.questions)) return [];
  const out: EngineQuestion[] = [];

  for (const raw of parsed.questions.slice(0, 3)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { id, text, options } = raw as Record<string, unknown>;
    if (typeof id !== 'string' || typeof text !== 'string' || text.trim() === '') continue;

    const opts: AnswerOption[] = [];
    if (Array.isArray(options)) {
      for (const o of options.slice(0, 4)) {
        if (typeof o !== 'object' || o === null) continue;
        const { key, label, detail, recommended } = o as Record<string, unknown>;
        if (typeof key !== 'string' || typeof label !== 'string' || label.trim() === '') continue;
        opts.push({
          key,
          label,
          detail: typeof detail === 'string' ? detail : '',
          recommended: recommended === true,
        });
      }
    }
    // 보기가 1개뿐이면 객관식의 의미가 없다. 주관식으로 떨어뜨린다.
    out.push({ id, text, options: opts.length >= 2 ? opts : [] });
  }
  return out;
}

// --- 응답 스키마 ------------------------------------------------------------

const SECTION_ENUM = { type: 'STRING', enum: SECTION_IDS } as const;

export const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    reply: { type: 'STRING' },
    setSections: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: SECTION_ENUM,
          content: { type: 'STRING' },
          status: { type: 'STRING', enum: ['empty', 'drafting', 'confirmed'] },
        },
        required: ['id', 'content', 'status'],
      },
    },
    addRequirements: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          title: { type: 'STRING' },
          description: { type: 'STRING' },
          acceptanceCriteria: { type: 'ARRAY', items: { type: 'STRING' } },
          priority: { type: 'STRING', enum: ['Must', 'Should', 'Could'] },
          dependsOn: { type: 'ARRAY', items: { type: 'STRING' } },
          section: { type: 'STRING', enum: ['FR', 'NFR'] },
        },
        required: ['id', 'title', 'description', 'acceptanceCriteria', 'priority', 'dependsOn', 'section'],
      },
    },
    addCostLines: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          item: { type: 'STRING' },
          unit: { type: 'STRING' },
          estimatedCost: { type: 'NUMBER' },
          verified: { type: 'BOOLEAN' },
          note: { type: 'STRING' },
        },
        required: ['item', 'unit', 'estimatedCost', 'verified', 'note'],
      },
    },
    addOpenQuestions: { type: 'ARRAY', items: { type: 'STRING' } },
    addUnverified: { type: 'ARRAY', items: { type: 'STRING' } },
    // FR-014 — 객관식 질문 카드. 최대 3개.
    questions: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING', enum: ['Q1', 'Q2', 'Q3'] },
          text: { type: 'STRING' },
          options: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                key: { type: 'STRING', enum: ['A', 'B', 'C', 'D'] },
                label: { type: 'STRING' },
                detail: { type: 'STRING' },
                recommended: { type: 'BOOLEAN' },
              },
              required: ['key', 'label', 'detail', 'recommended'],
            },
          },
        },
        required: ['id', 'text', 'options'],
      },
    },
    nextFocus: SECTION_ENUM,
  },
  required: ['reply', 'setSections', 'addOpenQuestions', 'questions', 'nextFocus'],
} as const;

// --- 파싱 -------------------------------------------------------------------

/** 코드펜스를 벗겨낸다 — FR-004 AC1. */
export function stripCodeFence(text: string): string {
  const t = text.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/.exec(t);
  return (fenced?.[1] ?? t).trim();
}

const SECTION_SET = new Set<string>(SECTION_IDS);

/** 벤더 고유 형식 → §5.2 정규 Patch[]. 형식 위반 항목은 조용히 버리고 applyPatches의 가드에 맡긴다. */
export function toPatches(parsed: Record<string, unknown>): Patch[] {
  const patches: Patch[] = [];
  const arr = (k: string): unknown[] => (Array.isArray(parsed[k]) ? (parsed[k] as unknown[]) : []);

  for (const s of arr('setSections')) {
    if (typeof s !== 'object' || s === null) continue;
    const { id, content, status } = s as Record<string, unknown>;
    if (typeof id === 'string' && SECTION_SET.has(id) && typeof content === 'string' && typeof status === 'string') {
      patches.push({ op: 'set_section', id: id as SectionId, content, status: status as never });
    }
  }
  for (const r of arr('addRequirements')) {
    patches.push({ op: 'add_requirement', requirement: r as never });
  }
  for (const q of arr('addOpenQuestions')) {
    if (typeof q === 'string') patches.push({ op: 'add_open_question', text: q });
  }
  for (const l of arr('addCostLines')) {
    patches.push({ op: 'add_cost_line', line: l as never });
  }
  for (const t of arr('addUnverified')) {
    if (typeof t === 'string') patches.push({ op: 'add_unverified', term: t });
  }
  return patches;
}

// --- 호출 -------------------------------------------------------------------

export interface CallOptions {
  apiKey: string;
  systemPrompt: string;
  /** 사용자 메시지들. 재시도 시 스키마 위반 안내가 뒤에 덧붙는다. */
  userParts: string[];
  fetchImpl?: typeof fetch;
  modelId?: string;
  signal?: AbortSignal;
}

export class EngineFailure extends Error {
  constructor(readonly error: EngineError) {
    super(error.message);
    this.name = 'EngineFailure';
  }
}

function classifyStatus(status: number, body: string): EngineError {
  if (status === 401 || status === 403) {
    return { kind: 'auth', status, message: 'API 키가 유효하지 않습니다. 설정에서 키를 확인해 주세요.' };
  }
  if (status === 429) {
    return { kind: 'rate_limit', status, message: '요청이 너무 많습니다. 잠시 후 자동으로 다시 시도합니다.' };
  }
  if (status >= 500) {
    return { kind: 'server', status, message: '엔진 서버에 일시적인 문제가 있습니다.' };
  }
  return { kind: 'unknown', status, message: `요청이 거부되었습니다 (HTTP ${status}). ${body.slice(0, 200)}` };
}

/** 1회 호출. 재시도는 상위(callEngine)가 담당한다. */
export async function callGemini(opts: CallOptions): Promise<RawEngineResponse> {
  const doFetch = opts.fetchImpl ?? fetch;
  const model = opts.modelId ?? ENGINE_MODEL.id;

  const body = {
    system_instruction: { parts: [{ text: opts.systemPrompt }] },
    contents: [{ role: 'user', parts: opts.userParts.map((text) => ({ text })) }],
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
      thinkingConfig: { thinkingBudget: THINKING_BUDGET },
    },
  };

  let res: Response;
  try {
    res = await doFetch(`${API_BASE}/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': opts.apiKey },
      body: JSON.stringify(body),
      signal: opts.signal,
    });
  } catch (e) {
    throw new EngineFailure({
      kind: 'network',
      message: `네트워크 연결에 실패했습니다: ${e instanceof Error ? e.message : String(e)}`,
    });
  }

  if (!res.ok) {
    throw new EngineFailure(classifyStatus(res.status, await res.text().catch(() => '')));
  }

  const json = (await res.json().catch(() => null)) as Record<string, any> | null;
  const candidate = json?.candidates?.[0];
  const text: unknown = candidate?.content?.parts?.[0]?.text;

  if (typeof text !== 'string') {
    throw new EngineFailure({
      kind: 'blocked',
      message: `엔진이 본문 없이 응답했습니다 (finishReason: ${candidate?.finishReason ?? '알 수 없음'})`,
    });
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(text));
  } catch {
    throw new EngineFailure({ kind: 'schema', message: '엔진 응답을 JSON으로 해석하지 못했습니다.' });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new EngineFailure({ kind: 'schema', message: '엔진 응답이 객체가 아닙니다.' });
  }

  const obj = parsed as Record<string, unknown>;
  if (typeof obj.reply !== 'string') {
    throw new EngineFailure({ kind: 'schema', message: '엔진 응답에 reply가 없습니다.' });
  }

  const u = json?.usageMetadata ?? {};
  const focus = obj.nextFocus;

  return {
    reply: obj.reply,
    patches: toPatches(obj),
    questions: toQuestions(obj),
    nextFocus: typeof focus === 'string' && SECTION_SET.has(focus) ? (focus as SectionId) : null,
    usage: {
      inputTokens: Number(u.promptTokenCount ?? 0),
      outputTokens: Number(u.candidatesTokenCount ?? 0),
      thinkingTokens: Number(u.thoughtsTokenCount ?? 0),
    },
  };
}
