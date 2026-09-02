import { describe, it, expect } from 'vitest';
import {
  bumpVersion,
  createDoc,
  deleteDoc,
  docKey,
  duplicateDoc,
  exportBackup,
  importBackup,
  listDocs,
  loadDoc,
  MAX_SNAPSHOTS,
  migrateLegacy,
  newId,
  saveDoc,
  snapshotAndBump,
  sortDocs,
  summarize,
  INDEX_KEY,
  type DocumentSummary,
} from './library.js';
import { EMPTY_SESSION, memoryStore, STATE_KEY, SESSION_KEY, type KV } from './persist.js';
import { createEmptyState, type PRDState } from '../types/prd.js';

function doc(name: string, over: Partial<PRDState> = {}): PRDState {
  return { ...createEmptyState(name), ...over };
}

/** set이 항상 실패하는 저장소 — 용량 초과·프라이빗 모드를 흉내낸다. */
function brokenStore(): KV {
  return {
    async get() { return undefined; },
    async set() { throw new Error('QuotaExceeded'); },
    async del() { /* 무시 */ },
  };
}

describe('bumpVersion', () => {
  it('마이너를 올리고 패치를 0으로 되돌린다', () => {
    expect(bumpVersion('0.1.0')).toBe('0.2.0');
    expect(bumpVersion('1.9.3')).toBe('1.10.0');
  });

  it('형식이 어긋나도 예외를 던지지 않는다', () => {
    expect(bumpVersion('draft')).toBe('draft.1');
    expect(bumpVersion('')).toBe('0.2.0');
  });
});

describe('newId', () => {
  it('중복되지 않는다', () => {
    const ids = new Set(Array.from({ length: 200 }, () => newId()));
    expect(ids.size).toBe(200);
  });
});

describe('목록', () => {
  it('저장한 문서가 목록에 뜬다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('첫 문서'));
    const docs = await listDocs(kv);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe(id);
    expect(docs[0]!.projectName).toBe('첫 문서');
  });

  it('여러 문서가 서로를 덮어쓰지 않는다 — 단일 키 시절의 결함', async () => {
    const kv = memoryStore();
    await createDoc(kv, doc('A'));
    await createDoc(kv, doc('B'));
    await createDoc(kv, doc('C'));
    expect((await listDocs(kv)).map((d) => d.projectName).sort()).toEqual(['A', 'B', 'C']);
  });

  it('미완성 항목 수를 함께 담는다', async () => {
    const kv = memoryStore();
    await createDoc(kv, doc('빈 문서'));
    expect((await listDocs(kv))[0]!.incompleteCount).toBeGreaterThan(0);
  });

  it('인덱스가 깨져 있으면 빈 목록을 준다 — 예외를 던지지 않는다', async () => {
    for (const bad of ['garbage', 42, null, { docs: 'nope' }]) {
      const kv = memoryStore({ [INDEX_KEY]: bad });
      await expect(listDocs(kv)).resolves.toEqual([]);
    }
  });

  it('항목 하나가 깨져도 나머지는 살린다', async () => {
    const kv = memoryStore({
      [INDEX_KEY]: { libraryVersion: 1, docs: [{ id: 'ok', projectName: '정상' }, { nope: true }, null] },
    });
    const docs = await listDocs(kv);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.id).toBe('ok');
  });

  it('최신 수정 순으로 정렬한다', () => {
    const mk = (id: string, at: string): DocumentSummary =>
      ({ id, projectName: id, version: '0.1.0', updatedAt: at, turn: 0, incompleteCount: 0, snapshotCount: 0 });
    const sorted = sortDocs([
      mk('a', '2026-01-01T00:00:00Z'),
      mk('c', '2026-03-01T00:00:00Z'),
      mk('b', '2026-02-01T00:00:00Z'),
    ]);
    expect(sorted.map((d) => d.id)).toEqual(['c', 'b', 'a']);
  });
});

describe('읽기/쓰기', () => {
  it('저장한 내용이 그대로 되살아난다', async () => {
    const kv = memoryStore();
    const s = doc('왕복', { turn: 7 });
    s.sections.S1.content = '개요 본문';
    const id = await createDoc(kv, s);

    const back = await loadDoc(kv, id);
    expect(back?.state.projectName).toBe('왕복');
    expect(back?.state.turn).toBe(7);
    expect(back?.state.sections.S1.content).toBe('개요 본문');
  });

  it('없는 문서를 열면 null이다', async () => {
    await expect(loadDoc(memoryStore(), 'nope')).resolves.toBeNull();
  });

  it('본문이 깨져 있으면 null이고 예외는 없다', async () => {
    const kv = memoryStore({ [docKey('x')]: { state: 'not-an-object' } });
    await expect(loadDoc(kv, 'x')).resolves.toBeNull();
  });

  it('저장 실패는 false를 돌려준다 — 예외를 던지지 않는다', async () => {
    await expect(saveDoc(brokenStore(), 'x', doc('A'), { ...EMPTY_SESSION })).resolves.toBe(false);
  });

  it('삭제하면 목록과 본문이 함께 사라진다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('버릴 문서'));
    await deleteDoc(kv, id);
    expect(await listDocs(kv)).toEqual([]);
    expect(await loadDoc(kv, id)).toBeNull();
  });

  it('복제는 원본을 건드리지 않는다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('원본'));
    const copyId = await duplicateDoc(kv, id);

    expect(copyId).not.toBe(id);
    expect((await loadDoc(kv, id))?.state.projectName).toBe('원본');
    expect((await loadDoc(kv, copyId!))?.state.projectName).toBe('원본 (사본)');
    expect(await listDocs(kv)).toHaveLength(2);
  });
});

describe('버전 스냅샷', () => {
  it('내보내면 버전이 오르고 직전 판본이 남는다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('제품', { version: '0.1.0' }));
    const loaded = await loadDoc(kv, id);

    const next = await snapshotAndBump(kv, id, loaded!.state, loaded!.meta);
    expect(next.version).toBe('0.2.0');

    const after = await loadDoc(kv, id);
    expect(after?.state.version).toBe('0.2.0');
    expect(after?.snapshots).toHaveLength(1);
    expect(after?.snapshots[0]!.version).toBe('0.1.0');
  });

  it('스냅샷은 상한을 넘지 않는다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('반복'));
    for (let i = 0; i < MAX_SNAPSHOTS + 5; i += 1) {
      const d = await loadDoc(kv, id);
      await snapshotAndBump(kv, id, d!.state, d!.meta);
    }
    const after = await loadDoc(kv, id);
    expect(after?.snapshots).toHaveLength(MAX_SNAPSHOTS);
    // 오래된 것부터 버린다 — 가장 최근 것이 남아야 한다
    expect(after?.snapshots.at(-1)?.version).not.toBe('0.1.0');
  });

  it('저장에 실패해도 버전은 올려 돌려준다 — 내보내기를 막지 않는다', async () => {
    const next = await snapshotAndBump(brokenStore(), 'x', doc('A', { version: '1.0.0' }), { ...EMPTY_SESSION });
    expect(next.version).toBe('1.1.0');
  });
});

describe('레거시 이관', () => {
  it('단일 키 문서를 보관함 첫 항목으로 옮기고 옛 키를 지운다', async () => {
    const old = doc('옛 문서', { turn: 3 });
    const kv = memoryStore({ [STATE_KEY]: old, [SESSION_KEY]: { inputTokens: 100, outputTokens: 50 } });

    const id = await migrateLegacy(kv);
    expect(id).not.toBeNull();

    const docs = await listDocs(kv);
    expect(docs).toHaveLength(1);
    expect(docs[0]!.projectName).toBe('옛 문서');

    const loaded = await loadDoc(kv, id!);
    expect(loaded?.state.turn).toBe(3);
    expect(loaded?.meta.inputTokens).toBe(100);

    expect(await kv.get(STATE_KEY)).toBeUndefined();
  });

  it('옮길 것이 없으면 null이다', async () => {
    await expect(migrateLegacy(memoryStore())).resolves.toBeNull();
  });

  it('옛 데이터가 깨져 있으면 이관하지 않고 원본을 남긴다', async () => {
    const kv = memoryStore({ [STATE_KEY]: 'garbage' });
    await expect(migrateLegacy(kv)).resolves.toBeNull();
    expect(await kv.get(STATE_KEY)).toBe('garbage');
  });
});

describe('전체 백업', () => {
  it('내보낸 백업을 빈 저장소로 가져오면 문서가 복원된다', async () => {
    const src = memoryStore();
    await createDoc(src, doc('A'));
    await createDoc(src, doc('B'));

    const backup = await exportBackup(src);
    expect(backup.docs).toHaveLength(2);

    const dst = memoryStore();
    const r = await importBackup(dst, JSON.stringify(backup));
    expect(r).toEqual({ ok: true, added: 2, skipped: 0 });
    expect((await listDocs(dst)).map((d) => d.projectName).sort()).toEqual(['A', 'B']);
  });

  it('같은 백업을 두 번 가져와도 기존 문서를 덮어쓰지 않는다', async () => {
    const kv = memoryStore();
    await createDoc(kv, doc('원본'));
    const backup = JSON.stringify(await exportBackup(kv));

    await importBackup(kv, backup);
    expect(await listDocs(kv)).toHaveLength(2);
  });

  it('백업이 아닌 파일은 거부한다', async () => {
    const kv = memoryStore();
    expect(await importBackup(kv, '{"kind":"other"}')).toEqual({
      ok: false, error: 'PRD Architect 백업 파일이 아닙니다.',
    });
    expect((await importBackup(kv, 'not json')).ok).toBe(false);
  });

  it('깨진 항목은 건너뛰고 나머지는 들여온다', async () => {
    const kv = memoryStore();
    const payload = JSON.stringify({
      kind: 'prd-architect-backup',
      libraryVersion: 1,
      exportedAt: '2026-09-02T00:00:00Z',
      docs: [{ id: 'good', state: doc('정상') }, { id: 'bad', state: 'garbage' }, null],
    });
    expect(await importBackup(kv, payload)).toEqual({ ok: true, added: 1, skipped: 2 });
  });
});

describe('판본 수 노출', () => {
  it('내보낼 때마다 목록 요약의 snapshotCount가 오른다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('판본'));
    expect((await listDocs(kv))[0]!.snapshotCount).toBe(0);

    let d = await loadDoc(kv, id);
    await snapshotAndBump(kv, id, d!.state, d!.meta);
    expect((await listDocs(kv))[0]!.snapshotCount).toBe(1);

    d = await loadDoc(kv, id);
    await snapshotAndBump(kv, id, d!.state, d!.meta);
    expect((await listDocs(kv))[0]!.snapshotCount).toBe(2);
  });

  it('이후 자동 저장이 판본 수를 0으로 되돌리지 않는다', async () => {
    const kv = memoryStore();
    const id = await createDoc(kv, doc('판본 보존'));
    const d = await loadDoc(kv, id);
    await snapshotAndBump(kv, id, d!.state, d!.meta);

    // 버전이 오른 뒤 이어서 인터뷰하면 saveDoc이 돈다. 이때 이력이 사라지면 안 된다.
    const after = await loadDoc(kv, id);
    await saveDoc(kv, id, { ...after!.state, turn: 9 }, after!.meta);

    expect((await listDocs(kv))[0]!.snapshotCount).toBe(1);
    expect((await loadDoc(kv, id))?.snapshots).toHaveLength(1);
  });
});

describe('summarize', () => {
  it('요약이 상태를 그대로 반영한다', () => {
    const s = summarize('id1', doc('요약 대상', { turn: 12, version: '2.0.0' }), '2026-09-02T00:00:00Z');
    expect(s).toMatchObject({ id: 'id1', projectName: '요약 대상', turn: 12, version: '2.0.0' });
  });
});
