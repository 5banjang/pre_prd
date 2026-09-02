// 앱 셸 — 스펙 §10 화면 구성.
//
//   ┌──────────────────────────────────────────────┐
//   │ PRD Architect   턴 12 · 추정 $0.14  [⚙ 설정] │
//   ├──────────────────────┬───────────────────────┤
//   │ 대화 영역             │ PRD 미리보기           │
//   │                      ├───────────────────────┤
//   │ [입력    ] [전송]     │ 완성도 68% · 미완성 4  │
//   └──────────────────────┴───────────────────────┘

import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { createEmptyState, type PRDState, type SectionId } from '../types/prd.js';
import { runTurn } from '../engine/callEngine.js';
import type { EngineError } from '../engine/geminiAdapter.js';
import type { RejectedPatch } from '../engine/applyPatches.js';
import { editSection, unlockSection } from '../engine/applyPatches.js';
import type { AnswerMap, EngineQuestion } from '../engine/question.js';
import { completeness, validate } from '../validator/validate.js';
import { toQuestions } from '../engine/geminiAdapter.js';
import {
  EMPTY_SESSION, clearApiKey, idbStore, loadApiKey, saveApiKey,
  type SessionMeta,
} from '../storage/persist.js';
import {
  createDoc, deleteDoc, duplicateDoc, exportBackup, importBackup,
  listDocs, loadDoc, migrateLegacy, saveDoc, snapshotAndBump,
  type DocumentSummary, type Snapshot,
} from '../storage/library.js';
import { renderDraft } from '../export/render.js';
import { downloadText, slug } from '../export/download.js';
import { Header } from './Header.js';
import { ChatPanel } from './ChatPanel.js';
import { PreviewPanel, type SectionFocus } from './PreviewPanel.js';
import { IssuePanel } from './IssuePanel.js';
import { ExportGate } from './ExportGate.js';
import { LibraryPanel } from './LibraryPanel.js';

/** 25턴에 한 번 안내한다 — FR-012 AC2. */
const TURN_NUDGE_AT = 25;
/** 자동 저장 디바운스. 연속 편집 중 매번 쓰지 않는다. */
const SAVE_DEBOUNCE_MS = 600;

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'failed';

export interface AppState {
  prd: PRDState;
  status: 'idle' | 'thinking';
  error: EngineError | null;
  rejected: RejectedPatch[];
  /** 누적 토큰 — FR-012 AC3 */
  inputTokens: number;
  outputTokens: number;
  apiKey: string;
  /** 25턴 안내를 이미 보여줬는가 */
  nudged: boolean;
  /** FR-014 — 이번 턴의 질문 카드와 사용자의 답 */
  questions: EngineQuestion[];
  answers: AnswerMap;
  /** 저장소에서 복구가 끝났는가. 끝나기 전에는 자동 저장하지 않는다. */
  booted: boolean;
  saved: SaveStatus;
  notice: string | null;
  /** 지금 열려 있는 문서 — FR-016. null이면 아직 부팅 중이다. */
  docId: string | null;
  docs: DocumentSummary[];
  /** 보관함 작업(열기·복제·삭제) 진행 중. 중복 클릭을 막는다. */
  libBusy: boolean;
}

type Action =
  | {
      type: 'boot'; docId: string; state: PRDState; apiKey: string;
      meta: SessionMeta; docs: DocumentSummary[]; warnings: string[];
    }
  | { type: 'setDocs'; docs: DocumentSummary[] }
  | { type: 'libBusy'; busy: boolean }
  | { type: 'openDoc'; docId: string; state: PRDState; meta: SessionMeta }
  | { type: 'send' }
  | {
      type: 'turnOk'; state: PRDState; rejected: RejectedPatch[];
      inTok: number; outTok: number; questions: EngineQuestion[];
    }
  | { type: 'answer'; id: string; patch: { choice?: string | null; note?: string } }
  | { type: 'mergeAnswers'; answers: AnswerMap }
  | { type: 'turnFail'; error: EngineError }
  | { type: 'dismissError' }
  | { type: 'setKey'; key: string }
  | { type: 'editSection'; id: SectionId; content: string }
  | { type: 'unlockSection'; id: SectionId }
  | { type: 'markNudged' }
  | { type: 'saveStatus'; saved: SaveStatus }
  | { type: 'import'; state: PRDState }
  | { type: 'bumped'; state: PRDState }
  | { type: 'reset' }
  | { type: 'notice'; text: string }
  | { type: 'dismissNotice' };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'boot':
      return {
        ...s,
        booted: true,
        docId: a.docId,
        docs: a.docs,
        prd: a.state,
        apiKey: a.apiKey,
        inputTokens: a.meta.inputTokens,
        outputTokens: a.meta.outputTokens,
        nudged: a.meta.nudged,
        // 답하다 만 카드도 살린다. 형식이 어긋난 건 toQuestions가 걸러낸다.
        questions: toQuestions({ questions: a.meta.questions }),
        notice: a.warnings.length > 0 ? a.warnings.join(' ') : null,
      };
    case 'setDocs':
      return { ...s, docs: a.docs };
    case 'libBusy':
      return { ...s, libBusy: a.busy };
    case 'openDoc':
      // 문서를 갈아끼운다. 이전 문서의 질문 카드·거부 목록은 따라오면 안 된다.
      return {
        ...s,
        docId: a.docId,
        prd: a.state,
        questions: toQuestions({ questions: a.meta.questions }),
        answers: {}, rejected: [], error: null,
        inputTokens: a.meta.inputTokens,
        outputTokens: a.meta.outputTokens,
        nudged: a.meta.nudged,
      };
    case 'send':
      // 보낸 질문은 즉시 치운다. 답이 이미 입력에 조립돼 나갔다.
      return { ...s, status: 'thinking', error: null, rejected: [], questions: [], answers: {} };
    case 'turnOk':
      return {
        ...s,
        status: 'idle',
        prd: a.state,
        rejected: a.rejected,
        questions: a.questions,
        answers: {},
        inputTokens: s.inputTokens + a.inTok,
        outputTokens: s.outputTokens + a.outTok,
      };
    case 'answer': {
      const cur = s.answers[a.id] ?? { choice: null, note: '' };
      return { ...s, answers: { ...s.answers, [a.id]: { ...cur, ...a.patch } } };
    }
    // 외부 AI에서 읽어온 답을 한꺼번에 얹는다. 합치는 규칙은 handoff.mergeAnswers가 이미 적용했다.
    case 'mergeAnswers':
      return { ...s, answers: a.answers };
    case 'turnFail':
      // 실패해도 진행 중 상태를 잃지 않는다 — NFR-004
      return { ...s, status: 'idle', error: a.error };
    case 'dismissError':
      return { ...s, error: null };
    case 'setKey':
      return { ...s, apiKey: a.key };
    case 'editSection':
      return { ...s, prd: editSection(s.prd, a.id, a.content) };
    case 'unlockSection':
      return { ...s, prd: unlockSection(s.prd, a.id) };
    case 'markNudged':
      return { ...s, nudged: true };
    case 'saveStatus':
      return { ...s, saved: a.saved };
    case 'import':
      return { ...s, prd: a.state, questions: [], answers: {}, rejected: [], error: null };
    case 'bumped':
      // 버전만 오른다. 대화·질문 카드는 그대로 이어간다 — 같은 문서를 계속 보완하는 중이다.
      return { ...s, prd: a.state };
    case 'reset':
      return {
        ...s,
        prd: createEmptyState(),
        questions: [], answers: {}, rejected: [], error: null,
        inputTokens: 0, outputTokens: 0, nudged: false, notice: null,
      };
    case 'notice':
      return { ...s, notice: a.text };
    case 'dismissNotice':
      return { ...s, notice: null };
  }
}

const initial: AppState = {
  prd: createEmptyState(),
  status: 'idle',
  error: null,
  rejected: [],
  inputTokens: 0,
  outputTokens: 0,
  apiKey: '',
  nudged: false,
  questions: [],
  answers: {},
  booted: false,
  saved: 'idle',
  notice: null,
  docId: null,
  docs: [],
  libBusy: false,
};

export function App() {
  const [s, dispatch] = useReducer(reducer, initial);
  const kv = useRef(idbStore()).current;

  // 점검 화면과 섹션 포커스는 문서 상태가 아니라 화면 상태다. PRDState를 오염시키지 않는다.
  const [gateOpen, setGateOpen] = useState(false);
  // 같은 섹션을 연속으로 눌러도 effect가 다시 돌아야 하므로 nonce를 함께 올린다.
  // rAF로 한 틱 비우는 방식은 배경 탭에서 콜백이 지연되어 점프가 통째로 실종된다.
  const [focus, setFocus] = useState<SectionFocus>(null);

  function jumpTo(id: SectionId) {
    setFocus((f) => ({ id, nonce: (f?.nonce ?? 0) + 1 }));
  }

  // 새로고침 후 복구 — FR-010 AC2 + 보관함 부팅 FR-016
  useEffect(() => {
    let alive = true;
    void (async () => {
      const warnings: string[] = [];

      // 단일 키 시절 문서를 보관함으로 옮긴다. 이미 옮겼으면 아무 일도 하지 않는다.
      try {
        if (await migrateLegacy(kv)) warnings.push('이전 문서를 보관함으로 옮겼습니다.');
      } catch {
        warnings.push('이전 문서를 옮기지 못했습니다. 새 문서로 시작합니다.');
      }

      const apiKey = await loadApiKey(kv);
      const docs = await listDocs(kv);

      // 가장 최근 문서를 연다. 없거나 깨졌으면 새로 만든다 — 앱은 항상 뜬다.
      let id = docs[0]?.id ?? null;
      let loaded = id ? await loadDoc(kv, id) : null;
      if (!loaded) {
        if (id) warnings.push('마지막 문서를 열지 못했습니다. 새 문서로 시작합니다.');
        id = await createDoc(kv, createEmptyState());
        loaded = await loadDoc(kv, id);
      }

      if (!alive) return;
      dispatch({
        type: 'boot',
        docId: id!,
        state: loaded?.state ?? createEmptyState(),
        meta: loaded?.meta ?? { ...EMPTY_SESSION },
        docs: await listDocs(kv),
        apiKey,
        warnings: [...warnings, ...(loaded?.warnings ?? [])],
      });
    })();
    return () => { alive = false; };
  }, [kv]);

  // 매 턴 종료 시 자동 저장 — FR-010 AC1. 이제 열려 있는 문서에 쓴다 (FR-016).
  const docId = s.docId;
  useEffect(() => {
    if (!s.booted || !docId) return;
    dispatch({ type: 'saveStatus', saved: 'saving' });
    const t = setTimeout(() => {
      const meta: SessionMeta = {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        nudged: s.nudged,
        questions: s.questions,
      };
      void saveDoc(kv, docId, s.prd, meta)
        .then((ok) => dispatch({ type: 'saveStatus', saved: ok ? 'saved' : 'failed' }));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [s.prd, s.booted, s.inputTokens, s.outputTokens, s.nudged, s.questions, docId, kv]);

  // 패치 적용 즉시 갱신된다 — FR-006 AC2. 상태가 바뀔 때만 다시 돈다.
  const issues = useMemo(() => validate(s.prd), [s.prd]);
  const score = useMemo(() => completeness(s.prd), [s.prd]);

  const [libOpen, setLibOpen] = useState(false);
  /** 보관함에서 펼친 문서의 판본 목록. 필요할 때만 읽는다 — 목록 열 때 전부 읽지 않는다. */
  const [history, setHistory] = useState<Record<string, Snapshot[]>>({});

  async function refreshDocs() {
    dispatch({ type: 'setDocs', docs: await listDocs(kv) });
  }

  /** 보관함 작업을 직렬화한다. 중간에 다른 문서를 열면 저장이 엇갈린다. */
  async function withBusy(fn: () => Promise<void>) {
    dispatch({ type: 'libBusy', busy: true });
    try {
      await fn();
    } finally {
      dispatch({ type: 'libBusy', busy: false });
    }
  }

  async function openDoc(id: string) {
    if (id === s.docId) { setLibOpen(false); return; }
    await withBusy(async () => {
      const d = await loadDoc(kv, id);
      if (!d) {
        // 열지 못해도 지금 문서는 그대로 둔다. 작업 중인 내용을 잃는 것이 최악이다.
        dispatch({ type: 'notice', text: '그 문서를 열지 못했습니다. 저장 데이터가 손상됐을 수 있습니다.' });
        return;
      }
      dispatch({ type: 'openDoc', docId: d.id, state: d.state, meta: d.meta });
      if (d.warnings.length > 0) dispatch({ type: 'notice', text: d.warnings.join(' ') });
      setLibOpen(false);
    });
  }

  async function newDoc() {
    await withBusy(async () => {
      const id = await createDoc(kv, createEmptyState());
      dispatch({ type: 'openDoc', docId: id, state: createEmptyState(), meta: { ...EMPTY_SESSION } });
      await refreshDocs();
      setLibOpen(false);
    });
  }

  async function copyDoc(id: string) {
    await withBusy(async () => {
      await duplicateDoc(kv, id);
      await refreshDocs();
    });
  }

  async function removeDoc(id: string) {
    await withBusy(async () => {
      await deleteDoc(kv, id);
      const rest = await listDocs(kv);
      dispatch({ type: 'setDocs', docs: rest });

      // 열려 있던 문서를 지웠으면 다른 문서로 옮겨간다. 빈 화면을 남기지 않는다.
      if (id === s.docId) {
        const nextId = rest[0]?.id ?? await createDoc(kv, createEmptyState());
        const d = await loadDoc(kv, nextId);
        dispatch({
          type: 'openDoc',
          docId: nextId,
          state: d?.state ?? createEmptyState(),
          meta: d?.meta ?? { ...EMPTY_SESSION },
        });
        await refreshDocs();
      }
    });
  }

  function downloadBackup() {
    void exportBackup(kv).then((backup) => {
      downloadText(
        `prd-architect-backup-${new Date().toISOString().slice(0, 10)}.json`,
        JSON.stringify(backup, null, 2),
        'application/json',
      );
    });
  }

  /** 지금 화면의 세션 메타. 저장 effect와 판본 찍기가 같은 값을 써야 한다. */
  function currentMeta(): SessionMeta {
    return {
      inputTokens: s.inputTokens,
      outputTokens: s.outputTokens,
      nudged: s.nudged,
      questions: s.questions,
    };
  }

  /**
   * 산출물을 받아간 순간 판본을 굳히고 버전을 올린다 — 개정안 #02 §B2 AC3.
   *
   * 개발 AI에게 이미 넘긴 PRD가 조용히 바뀌면 "기존 내용을 뒤집는" 바로 그 문제가
   * 문서 레벨에서 재발한다. 넘긴 판본은 지우지 않고 남긴다.
   */
  async function stampVersion() {
    if (!s.docId) return;
    const next = await snapshotAndBump(kv, s.docId, s.prd, currentMeta());
    dispatch({ type: 'bumped', state: next });
    setHistory((h) => {
      const { [s.docId!]: _drop, ...rest } = h;
      return rest;               // 이력이 바뀌었다. 다음에 펼칠 때 다시 읽는다.
    });
    await refreshDocs();
  }

  /** 판본 목록은 펼칠 때 읽는다. 이미 읽었으면 다시 읽지 않는다. */
  function loadHistory(id: string) {
    if (history[id]) return;
    void loadDoc(kv, id).then((d) => {
      if (d) setHistory((h) => ({ ...h, [id]: d.snapshots }));
    });
  }

  /** 지난 판본의 산출물을 다시 받는다 — §B2 AC3 후반부. */
  function downloadSnapshot(id: string, index: number) {
    const snap = history[id]?.[index];
    if (!snap) return;
    downloadText(
      `${slug(snap.state.projectName)}-v${snap.version}-PRD.md`,
      renderDraft(snap.state, validate(snap.state)),
    );
  }

  function uploadBackup(file: File) {
    void file.text().then(async (text) => {
      const r = await importBackup(kv, text);
      await refreshDocs();
      dispatch({
        type: 'notice',
        text: r.ok
          ? `백업에서 ${r.added}개를 들여왔습니다.${r.skipped > 0 ? ` ${r.skipped}개는 읽지 못해 건너뛰었습니다.` : ''}`
          : r.error,
      });
    });
  }

  function setKey(key: string) {
    dispatch({ type: 'setKey', key });
    void saveApiKey(kv, key);
  }

  async function send(text: string) {
    if (!s.apiKey || s.status === 'thinking') return;
    dispatch({ type: 'send' });

    const r = await runTurn(s.prd, text, { apiKey: s.apiKey });
    if (r.ok) {
      dispatch({
        type: 'turnOk',
        state: r.state,
        rejected: r.rejected,
        questions: r.questions,
        inTok: r.usage.inputTokens,
        outTok: r.usage.outputTokens,
      });
      if (r.state.turn >= TURN_NUDGE_AT && !s.nudged) dispatch({ type: 'markNudged' });
    } else {
      dispatch({ type: 'turnFail', error: r.error });
    }
  }

  return (
    <div className="app">
      <Header
        state={s.prd}
        inputTokens={s.inputTokens}
        outputTokens={s.outputTokens}
        apiKey={s.apiKey}
        saved={s.saved}
        onKeyChange={setKey}
        onClearKey={() => { dispatch({ type: 'setKey', key: '' }); void clearApiKey(kv); }}
        onImport={(state) => dispatch({ type: 'import', state })}
        onReset={() => { void newDoc(); }}
        onOpenLibrary={() => { void refreshDocs(); setLibOpen(true); }}
        docCount={s.docs.length}
      />

      {s.notice && (
        <div className="banner">
          {s.notice}
          <button className="link" onClick={() => dispatch({ type: 'dismissNotice' })}>닫기</button>
        </div>
      )}

      <main className="panes">
        <ChatPanel
          state={s.prd}
          history={s.prd.history}
          status={s.status}
          error={s.error}
          rejected={s.rejected}
          hasKey={s.apiKey.length > 0}
          showNudge={s.prd.turn >= TURN_NUDGE_AT && s.nudged}
          questions={s.questions}
          answers={s.answers}
          onAnswer={(id, patch) => dispatch({ type: 'answer', id, patch })}
          onMergeAnswers={(answers) => dispatch({ type: 'mergeAnswers', answers })}
          onSend={send}
          onDismissError={() => dispatch({ type: 'dismissError' })}
          onUnlock={(id) => dispatch({ type: 'unlockSection', id })}
        />

        <div className="right">
          <PreviewPanel
            state={s.prd}
            focus={focus}
            onEdit={(id, content) => dispatch({ type: 'editSection', id, content })}
            onUnlock={(id) => dispatch({ type: 'unlockSection', id })}
          />
          <IssuePanel
            issues={issues}
            completeness={score}
            state={s.prd}
            onJump={jumpTo}
            onOpenGate={() => setGateOpen(true)}
          />
        </div>
      </main>

      {libOpen && (
        <LibraryPanel
          docs={s.docs}
          currentId={s.docId}
          busy={s.libBusy}
          onOpen={(id) => { void openDoc(id); }}
          onCreate={() => { void newDoc(); }}
          onDuplicate={(id) => { void copyDoc(id); }}
          onDelete={(id) => { void removeDoc(id); }}
          onExportBackup={downloadBackup}
          onImportBackup={uploadBackup}
          snapshots={history}
          onLoadHistory={loadHistory}
          onDownloadSnapshot={downloadSnapshot}
          onClose={() => setLibOpen(false)}
        />
      )}

      {gateOpen && (
        <ExportGate
          state={s.prd}
          issues={issues}
          onJump={jumpTo}
          onExported={() => { void stampVersion(); }}
          onClose={() => setGateOpen(false)}
        />
      )}
    </div>
  );
}
