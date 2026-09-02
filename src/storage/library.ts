// 문서 보관함 — FR-016 (개정안 #02 §B2).
//
// 기존 persist.ts는 `prd-architect:state` **단일 키**에 저장했다. 즉 문서가 하나뿐이고
// 새 프로젝트를 시작하면 이전 것을 말없이 덮어썼다. 이 파일이 그 결함을 고친다.
//
// 저장 배치:
//   prd-architect:index        → StoredIndex        (목록)
//   prd-architect:doc:<id>     → StoredDoc          (본문 + 스냅샷)
//   prd-architect:apikey       → string             (문서와 무관. persist.ts 소관)
//
// 주의: 여기서 다루는 LIBRARY_VERSION은 **저장 배치**의 버전이다.
// PRDState 자체의 `schemaVersion`(persist.ts CURRENT_SCHEMA)과는 다른 축이며,
// 문서 모양이 바뀌지 않았으므로 후자는 올리지 않는다.

import type { PRDState } from '../types/prd.js';
import { validate } from '../validator/validate.js';
import {
  EMPTY_SESSION, STATE_KEY, SESSION_KEY,
  migrate, type KV, type SessionMeta,
} from './persist.js';

export const INDEX_KEY = 'prd-architect:index';
export const LIBRARY_VERSION = 1;

export const docKey = (id: string) => `prd-architect:doc:${id}`;

/** 스냅샷을 무한히 쌓으면 저장소를 먹는다. 오래된 것부터 버린다. */
export const MAX_SNAPSHOTS = 10;

export interface DocumentSummary {
  id: string;
  projectName: string;
  version: string;
  /** ISO 8601 */
  updatedAt: string;
  turn: number;
  /** 목록에서 완성도가 바로 보인다 — 개정안 #02 §B2 AC1 */
  incompleteCount: number;
  /** 내보낸 판본 수 — 목록에서 버전 이력이 있는지 바로 보인다 (§B2 AC3) */
  snapshotCount: number;
}

export interface Snapshot {
  version: string;
  at: string;
  state: PRDState;
}

export interface StoredDoc {
  state: PRDState;
  meta: SessionMeta;
  /** 내보낼 때마다 찍힌다. 최신이 뒤. 개발 AI에게 넘긴 판본이 조용히 사라지지 않게 한다. */
  snapshots: Snapshot[];
}

interface StoredIndex {
  libraryVersion: number;
  docs: DocumentSummary[];
}

// --- 순수 헬퍼 --------------------------------------------------------------

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function newId(): string {
  // crypto.randomUUID는 안전 컨텍스트에서만 있다. 없으면 시간 + 난수로 충분하다.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

/** `0.1.0` → `0.2.0`. 형식이 어긋나면 그대로 두고 뒤에 하나 붙인다. */
export function bumpVersion(version: string): string {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(version.trim());
  if (!m) return version.trim() === '' ? '0.2.0' : `${version.trim()}.1`;
  return `${m[1]}.${Number(m[2]) + 1}.0`;
}

export function summarize(
  id: string, state: PRDState, updatedAt = new Date().toISOString(), snapshotCount = 0,
): DocumentSummary {
  return {
    id,
    projectName: state.projectName,
    version: state.version,
    updatedAt,
    turn: state.turn,
    incompleteCount: validate(state).filter((i) => i.severity === 'incomplete').length,
    snapshotCount,
  };
}

function readSummary(raw: unknown): DocumentSummary | null {
  if (!isRecord(raw) || typeof raw.id !== 'string' || raw.id === '') return null;
  return {
    id: raw.id,
    projectName: typeof raw.projectName === 'string' ? raw.projectName : '',
    version: typeof raw.version === 'string' ? raw.version : '0.1.0',
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : '',
    turn: typeof raw.turn === 'number' && raw.turn >= 0 ? raw.turn : 0,
    incompleteCount:
      typeof raw.incompleteCount === 'number' && raw.incompleteCount >= 0 ? raw.incompleteCount : 0,
    snapshotCount:
      typeof raw.snapshotCount === 'number' && raw.snapshotCount >= 0 ? raw.snapshotCount : 0,
  };
}

/** 최신 수정 순. 같으면 이름 순. */
export function sortDocs(docs: readonly DocumentSummary[]): DocumentSummary[] {
  return [...docs].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt) || a.projectName.localeCompare(b.projectName));
}

// --- 목록 -------------------------------------------------------------------

/**
 * 깨진 레코드는 건너뛴다. 목록 전체가 죽으면 안 된다 — 개정안 #02 §B2 AC5.
 */
export async function listDocs(kv: KV): Promise<DocumentSummary[]> {
  let raw: unknown;
  try {
    raw = await kv.get<unknown>(INDEX_KEY);
  } catch {
    return [];
  }
  if (!isRecord(raw) || !Array.isArray(raw.docs)) return [];
  const docs = raw.docs.map(readSummary).filter((d): d is DocumentSummary => d !== null);
  return sortDocs(docs);
}

async function writeIndex(kv: KV, docs: readonly DocumentSummary[]): Promise<boolean> {
  const index: StoredIndex = { libraryVersion: LIBRARY_VERSION, docs: sortDocs(docs) };
  try {
    await kv.set(INDEX_KEY, index);
    return true;
  } catch {
    return false;
  }
}

async function upsertSummary(kv: KV, s: DocumentSummary): Promise<boolean> {
  const docs = await listDocs(kv);
  const next = docs.filter((d) => d.id !== s.id);
  next.push(s);
  return writeIndex(kv, next);
}

// --- 읽기 / 쓰기 -------------------------------------------------------------

export interface LoadedDoc {
  id: string;
  state: PRDState;
  meta: SessionMeta;
  snapshots: Snapshot[];
  warnings: string[];
}

/** 저장된 문서 하나를 되살린다. 본문이 깨져 있으면 null을 돌려주고 앱은 계속 돈다. */
export async function loadDoc(kv: KV, id: string): Promise<LoadedDoc | null> {
  let raw: unknown;
  try {
    raw = await kv.get<unknown>(docKey(id));
  } catch {
    return null;
  }
  if (!isRecord(raw)) return null;

  const r = migrate(raw.state);
  if (!r.ok) return null;

  const snapshots: Snapshot[] = Array.isArray(raw.snapshots)
    ? raw.snapshots.flatMap((s): Snapshot[] => {
        if (!isRecord(s)) return [];
        const sr = migrate(s.state);
        if (!sr.ok) return [];
        return [{
          version: typeof s.version === 'string' ? s.version : '',
          at: typeof s.at === 'string' ? s.at : '',
          state: sr.state,
        }];
      })
    : [];

  return {
    id,
    state: r.state,
    meta: isRecord(raw.meta) ? { ...EMPTY_SESSION, ...(raw.meta as Partial<SessionMeta>) } : { ...EMPTY_SESSION },
    snapshots,
    warnings: r.warnings,
  };
}

/** 자동 저장. 본문과 목록을 함께 갱신한다. 실패해도 예외를 던지지 않는다. */
export async function saveDoc(
  kv: KV, id: string, state: PRDState, meta: SessionMeta,
): Promise<boolean> {
  const prev = await loadDoc(kv, id);
  const doc: StoredDoc = { state, meta, snapshots: prev?.snapshots ?? [] };
  try {
    await kv.set(docKey(id), doc);
  } catch {
    return false;
  }
  return upsertSummary(kv, summarize(id, state, new Date().toISOString(), doc.snapshots.length));
}

export async function createDoc(kv: KV, state: PRDState): Promise<string> {
  const id = newId();
  await saveDoc(kv, id, state, { ...EMPTY_SESSION });
  return id;
}

export async function deleteDoc(kv: KV, id: string): Promise<void> {
  try { await kv.del(docKey(id)); } catch { /* 무시 */ }
  const docs = await listDocs(kv);
  await writeIndex(kv, docs.filter((d) => d.id !== id));
}

/** 사본을 만든다. 이름 뒤에 (사본)을 붙이고 버전·턴은 그대로 둔다. */
export async function duplicateDoc(kv: KV, id: string): Promise<string | null> {
  const doc = await loadDoc(kv, id);
  if (!doc) return null;
  const copy: PRDState = {
    ...doc.state,
    projectName: `${doc.state.projectName || '(제목 미정)'} (사본)`,
  };
  return createDoc(kv, copy);
}

/**
 * 내보내기 시점에 판본을 찍고 버전을 올린다 — 개정안 #02 §B2.
 *
 * 개발 AI에게 이미 넘긴 PRD가 조용히 바뀌면 "기존 내용을 뒤집는" 문제가
 * 문서 레벨에서 재발한다. 그래서 이전 판본을 지우지 않는다.
 */
export async function snapshotAndBump(
  kv: KV, id: string, state: PRDState, meta: SessionMeta,
): Promise<PRDState> {
  const prev = await loadDoc(kv, id);
  const snapshots = [
    ...(prev?.snapshots ?? []),
    { version: state.version, at: new Date().toISOString(), state },
  ].slice(-MAX_SNAPSHOTS);

  const next: PRDState = { ...state, version: bumpVersion(state.version) };
  const doc: StoredDoc = { state: next, meta, snapshots };
  try {
    await kv.set(docKey(id), doc);
  } catch {
    // 저장에 실패해도 문서는 내보낼 수 있어야 한다. 버전만 올려서 돌려준다.
    return next;
  }
  await upsertSummary(kv, summarize(id, next, new Date().toISOString(), snapshots.length));
  return next;
}

// --- 레거시 이관 -------------------------------------------------------------

/**
 * 단일 키 시절(`prd-architect:state`)의 문서를 보관함 첫 항목으로 옮긴다.
 *
 * 이관에 성공하면 옛 키를 지운다. 실패하면 **옛 키를 남긴다** — 데이터를 잃느니
 * 다음 실행에서 다시 시도하는 편이 낫다.
 */
export async function migrateLegacy(kv: KV): Promise<string | null> {
  let raw: unknown;
  try {
    raw = await kv.get<unknown>(STATE_KEY);
  } catch {
    return null;
  }
  if (raw === undefined) return null;

  const r = migrate(raw);
  if (!r.ok) return null;

  let meta: SessionMeta = { ...EMPTY_SESSION };
  try {
    const m = await kv.get<unknown>(SESSION_KEY);
    if (isRecord(m)) meta = { ...EMPTY_SESSION, ...(m as Partial<SessionMeta>) };
  } catch { /* 메타는 없어도 된다 */ }

  const id = newId();
  const ok = await saveDoc(kv, id, r.state, meta);
  if (!ok) return null;

  try { await kv.del(STATE_KEY); } catch { /* 다음 실행에서 다시 시도한다 */ }
  try { await kv.del(SESSION_KEY); } catch { /* 무시 */ }
  return id;
}

// --- 전체 백업 ---------------------------------------------------------------

export interface Backup {
  kind: 'prd-architect-backup';
  libraryVersion: number;
  exportedAt: string;
  docs: { id: string; state: PRDState; snapshots: Snapshot[] }[];
}

/** 서버 없이 기기를 옮길 수 있어야 한다 — 개정안 #02 §B2 AC6. */
export async function exportBackup(kv: KV): Promise<Backup> {
  const summaries = await listDocs(kv);
  const docs: Backup['docs'] = [];
  for (const s of summaries) {
    const d = await loadDoc(kv, s.id);
    if (d) docs.push({ id: d.id, state: d.state, snapshots: d.snapshots });
  }
  return {
    kind: 'prd-architect-backup',
    libraryVersion: LIBRARY_VERSION,
    exportedAt: new Date().toISOString(),
    docs,
  };
}

export type ImportResult = { ok: true; added: number; skipped: number } | { ok: false; error: string };

/** 가져오기는 **덮어쓰지 않는다.** 같은 id가 있으면 새 id로 들여온다. */
export async function importBackup(kv: KV, text: string): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'JSON으로 읽을 수 없는 파일입니다.' };
  }
  if (!isRecord(raw) || raw.kind !== 'prd-architect-backup' || !Array.isArray(raw.docs)) {
    return { ok: false, error: 'PRD Architect 백업 파일이 아닙니다.' };
  }

  const existing = new Set((await listDocs(kv)).map((d) => d.id));
  let added = 0;
  let skipped = 0;

  for (const entry of raw.docs) {
    if (!isRecord(entry)) { skipped += 1; continue; }
    const r = migrate(entry.state);
    if (!r.ok) { skipped += 1; continue; }
    const id = typeof entry.id === 'string' && entry.id !== '' && !existing.has(entry.id)
      ? entry.id
      : newId();
    const ok = await saveDoc(kv, id, r.state, { ...EMPTY_SESSION });
    if (ok) { existing.add(id); added += 1; } else { skipped += 1; }
  }

  return { ok: true, added, skipped };
}
