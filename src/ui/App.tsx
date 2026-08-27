// 앱 셸 — 스펙 §10 화면 구성.
//
//   ┌──────────────────────────────────────────────┐
//   │ PRD Architect   턴 12 · 추정 $0.14  [⚙ 설정] │
//   ├──────────────────────┬───────────────────────┤
//   │ 대화 영역             │ PRD 미리보기           │
//   │                      ├───────────────────────┤
//   │ [입력    ] [전송]     │ ⚠ 내보내기 차단 (4)    │
//   └──────────────────────┴───────────────────────┘

import { useEffect, useMemo, useReducer, useRef } from 'react';
import { createEmptyState, type PRDState, type SectionId } from '../types/prd.js';
import { runTurn } from '../engine/callEngine.js';
import type { EngineError } from '../engine/geminiAdapter.js';
import type { RejectedPatch } from '../engine/applyPatches.js';
import { editSection, unlockSection } from '../engine/applyPatches.js';
import type { AnswerMap, EngineQuestion } from '../engine/question.js';
import { validate } from '../validator/validate.js';
import { toQuestions } from '../engine/geminiAdapter.js';
import {
  clearApiKey, clearSession, idbStore, loadSession, saveApiKey, saveSessionMeta, saveState,
  type SessionMeta,
} from '../storage/persist.js';
import { Header } from './Header.js';
import { ChatPanel } from './ChatPanel.js';
import { PreviewPanel } from './PreviewPanel.js';
import { IssuePanel } from './IssuePanel.js';

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
}

type Action =
  | { type: 'boot'; state: PRDState | null; apiKey: string; meta: SessionMeta; warnings: string[] }
  | { type: 'send' }
  | {
      type: 'turnOk'; state: PRDState; rejected: RejectedPatch[];
      inTok: number; outTok: number; questions: EngineQuestion[];
    }
  | { type: 'answer'; id: string; patch: { choice?: string | null; note?: string } }
  | { type: 'turnFail'; error: EngineError }
  | { type: 'dismissError' }
  | { type: 'setKey'; key: string }
  | { type: 'editSection'; id: SectionId; content: string }
  | { type: 'unlockSection'; id: SectionId }
  | { type: 'markNudged' }
  | { type: 'saveStatus'; saved: SaveStatus }
  | { type: 'import'; state: PRDState }
  | { type: 'reset' }
  | { type: 'dismissNotice' };

function reducer(s: AppState, a: Action): AppState {
  switch (a.type) {
    case 'boot':
      return {
        ...s,
        booted: true,
        prd: a.state ?? s.prd,
        apiKey: a.apiKey,
        inputTokens: a.meta.inputTokens,
        outputTokens: a.meta.outputTokens,
        nudged: a.meta.nudged,
        // 답하다 만 카드도 살린다. 형식이 어긋난 건 toQuestions가 걸러낸다.
        questions: toQuestions({ questions: a.meta.questions }),
        notice: a.warnings.length > 0 ? a.warnings.join(' ') : null,
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
    case 'reset':
      return {
        ...s,
        prd: createEmptyState(),
        questions: [], answers: {}, rejected: [], error: null,
        inputTokens: 0, outputTokens: 0, nudged: false, notice: null,
      };
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
};

export function App() {
  const [s, dispatch] = useReducer(reducer, initial);
  const kv = useRef(idbStore()).current;

  // 새로고침 후 복구 — FR-010 AC2
  useEffect(() => {
    let alive = true;
    void loadSession(kv).then((r) => {
      if (alive) dispatch({ type: 'boot', ...r });
    });
    return () => { alive = false; };
  }, [kv]);

  // 매 턴 종료 시 자동 저장 — FR-010 AC1
  useEffect(() => {
    if (!s.booted) return;
    dispatch({ type: 'saveStatus', saved: 'saving' });
    const t = setTimeout(() => {
      const meta: SessionMeta = {
        inputTokens: s.inputTokens,
        outputTokens: s.outputTokens,
        nudged: s.nudged,
        questions: s.questions,
      };
      void Promise.all([saveState(kv, s.prd), saveSessionMeta(kv, meta)])
        .then(([ok]) => dispatch({ type: 'saveStatus', saved: ok ? 'saved' : 'failed' }));
    }, SAVE_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [s.prd, s.booted, s.inputTokens, s.outputTokens, s.nudged, s.questions, kv]);

  // 패치 적용 즉시 갱신된다 — FR-006 AC2. 상태가 바뀔 때만 다시 돈다.
  const issues = useMemo(() => validate(s.prd), [s.prd]);
  const blocking = issues.filter((i) => i.severity === 'block');

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
        onReset={() => { dispatch({ type: 'reset' }); void clearSession(kv); }}
      />

      {s.notice && (
        <div className="banner">
          {s.notice}
          <button className="link" onClick={() => dispatch({ type: 'dismissNotice' })}>닫기</button>
        </div>
      )}

      <main className="panes">
        <ChatPanel
          history={s.prd.history}
          status={s.status}
          error={s.error}
          rejected={s.rejected}
          hasKey={s.apiKey.length > 0}
          showNudge={s.prd.turn >= TURN_NUDGE_AT && s.nudged}
          questions={s.questions}
          answers={s.answers}
          onAnswer={(id, patch) => dispatch({ type: 'answer', id, patch })}
          onSend={send}
          onDismissError={() => dispatch({ type: 'dismissError' })}
          onUnlock={(id) => dispatch({ type: 'unlockSection', id })}
        />

        <div className="right">
          <PreviewPanel
            state={s.prd}
            onEdit={(id, content) => dispatch({ type: 'editSection', id, content })}
            onUnlock={(id) => dispatch({ type: 'unlockSection', id })}
          />
          <IssuePanel issues={issues} canExport={blocking.length === 0} state={s.prd} />
        </div>
      </main>
    </div>
  );
}
