// 첨부 1회 추출 — 개정안 #02 §B1 (FR-015).
//
//   파일 → 1회 호출 → 섹션 패치 + 가정 등록 → 원본 폐기
//
// 원본은 이 함수 안에서만 존재하고, 끝나면 base64 문자열까지 사라진다.
// `AttachmentRecord`에 남는 것은 파일명·크기·요약·쓴 토큰뿐이다.
//
// 실패해도 상태는 그대로다 (AC6). 호출이 성공한 뒤에야 새 상태를 만든다.

import type { AttachmentKind, AttachmentRecord, PRDState, SectionId } from '../types/prd.js';
import { applyPatches, type RejectedPatch } from './applyPatches.js';
import { toBase64 } from './attachment.js';
import {
  EngineFailure, callGemini, type EngineError, type EngineUsage,
} from './geminiAdapter.js';
import { stateForPrompt } from './prompt.js';
import { EXTRACT_PROMPT } from './systemPrompt.js';
import { validate, type ValidationIssue } from '../validator/validate.js';

export interface ExtractDeps {
  apiKey: string;
  fetchImpl?: typeof fetch;
  modelId?: string;
  signal?: AbortSignal;
  /** 테스트에서 고정값을 넣는다. */
  newId?: () => string;
}

export interface ExtractSuccess {
  ok: true;
  state: PRDState;
  record: AttachmentRecord;
  /** 화면에 보여줄 요약. record.summary와 같은 문장이다. */
  reply: string;
  issues: ValidationIssue[];
  rejected: RejectedPatch[];
  usage: EngineUsage;
}

export type ExtractResult = ExtractSuccess | { ok: false; error: EngineError; state: PRDState };

/** 자료를 어디에 쓸지 사용자가 한 줄 덧붙일 수 있다. 없으면 엔진이 알아서 배치한다. */
export interface ExtractInput {
  kind: AttachmentKind;
  mimeType: string;
  name: string;
  bytes: number;
  file: Blob;
  note?: string;
}

/** 첨부와 함께 보낼 본문. 상태 JSON을 함께 실어야 어디가 비었는지 알고 채운다. */
export function buildExtractPrompt(state: PRDState, input: ExtractInput): string {
  const kindLabel = input.kind === 'audio' ? '녹음 파일' : '문서';
  const blocks = [
    `# 첨부 자료\n${kindLabel} 1건: ${input.name}`,
    input.note?.trim()
      ? `# 사용자가 덧붙인 말\n${input.note.trim()}`
      : '# 사용자가 덧붙인 말\n(없음. 자료를 읽고 알맞은 항목에 배치하라.)',
    `# 현재 PRD 상태 (JSON)\n${JSON.stringify(stateForPrompt(state), null, 2)}`,
  ];
  return blocks.join('\n\n');
}

function isEngineFailure(e: unknown): e is EngineFailure {
  return e instanceof EngineFailure;
}

const randomId = (): string =>
  (globalThis.crypto?.randomUUID?.() ?? `att-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);

/**
 * 자료 1건을 읽어 상태에 반영한다.
 *
 * 재시도하지 않는다 — 첨부는 요청이 크고 비싸다. 한 번 실패하면 사유를 알리고
 * 사용자가 다시 누르게 한다. 헛되이 두 번 보내면 토큰만 두 배로 쓴다.
 */
export async function extractAttachment(
  state: PRDState,
  input: ExtractInput,
  deps: ExtractDeps,
): Promise<ExtractResult> {
  let dataBase64: string;
  try {
    dataBase64 = await toBase64(input.file);
  } catch {
    return {
      ok: false,
      state,
      error: { kind: 'unknown', message: '파일을 읽지 못했습니다. 다른 파일로 다시 시도해 주세요.' },
    };
  }

  let raw;
  try {
    raw = await callGemini({
      apiKey: deps.apiKey,
      systemPrompt: EXTRACT_PROMPT,
      userParts: [buildExtractPrompt(state, input)],
      inlineParts: [{ mimeType: input.mimeType, dataBase64 }],
      fetchImpl: deps.fetchImpl,
      modelId: deps.modelId,
      signal: deps.signal,
    });
  } catch (e) {
    if (!isEngineFailure(e)) throw e;
    // 상태는 손대지 않은 채로 돌려준다 — AC6
    return { ok: false, state, error: e.error };
  }

  const { state: applied, rejected } = applyPatches(state, raw.patches);

  const touched = [...new Set(
    raw.patches
      .filter((p): p is Extract<typeof p, { op: 'set_section' }> => p.op === 'set_section')
      .map((p) => p.id),
  )] as SectionId[];

  const record: AttachmentRecord = {
    id: (deps.newId ?? randomId)(),
    kind: input.kind,
    name: input.name,
    bytes: input.bytes,
    extractedAtTurn: state.turn,
    tokensUsed: raw.usage.inputTokens + raw.usage.outputTokens,
    summary: raw.reply,
    touchedSections: touched,
  };

  // 대화에도 흔적을 남긴다. 무엇을 읽혔는지 사용자가 스크롤해 다시 볼 수 있어야 하고,
  // 다음 턴의 최근 이력에 실려 엔진도 "자료에서 온 내용"임을 안다.
  // 남는 것은 요약뿐이다 — 원본은 이 함수를 벗어나지 않는다.
  const next: PRDState = {
    ...applied,
    attachments: [...applied.attachments, record],
    history: [
      ...applied.history,
      { turn: state.turn, role: 'user', text: `[자료 첨부] ${input.name}` },
      { turn: state.turn, role: 'engine', text: raw.reply },
    ],
  };

  return {
    ok: true,
    state: next,
    record,
    reply: raw.reply,
    issues: validate(next),
    rejected,
    usage: raw.usage,
  };
}
