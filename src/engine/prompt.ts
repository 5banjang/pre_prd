// 프롬프트 조립 — 스펙 §5.1.
//
//   [시스템 지침 — §5.2]
//   [현재 PRD 상태 JSON — sections의 content 포함 전문]
//   [직전 대화 6턴]
//   [사용자 최신 입력]
//
// history 전체를 넣지 않는다. 상태 JSON에 확정 내용이 이미 있으므로 대화 원문은
// 최근 것만 있으면 된다. 이것이 컨텍스트 유실을 막는 구조다 (FR-002).

import { MAX_HISTORY_TURNS } from '../config.js';
import type { HistoryEntry, PRDState } from '../types/prd.js';

/** 프롬프트에 실을 상태. history는 별도로 최근 N턴만 렌더링하므로 제외한다. */
type StateForPrompt = Omit<PRDState, 'history'>;

export function stateForPrompt(state: PRDState): StateForPrompt {
  const { history: _history, ...rest } = state;
  return rest;
}

/** 최근 N턴만 잘라낸다 — FR-002. */
export function recentHistory(
  history: readonly HistoryEntry[],
  maxTurns = MAX_HISTORY_TURNS,
): HistoryEntry[] {
  return history.slice(-maxTurns);
}

/**
 * 잘린 이력이 있으면 **그 사실을 엔진에게 명시한다.**
 *
 * M7 실사용에서 잡힌 문제: 이 블록이 전체 대화인지 잘린 것인지 알려주지 않으니
 * 엔진이 창 밖의 발화를 "원문 인용"이라며 지어냈다. 유실 자체는 설계대로지만
 * (원칙 1 — 상태는 앱이 소유), **유실을 모르는 것**은 설계가 아니라 결함이다.
 */
function renderHistory(entries: readonly HistoryEntry[], omitted: number): string {
  if (entries.length === 0) return '(이전 대화 없음. 이번이 첫 턴이다.)';
  const lines = entries.map((e) => `[${e.role === 'user' ? '사용자' : '엔진'}] ${e.text}`);
  if (omitted > 0) {
    lines.unshift(
      `(앞선 ${omitted}턴은 이 프롬프트에 실리지 않았다. 그 내용은 위 상태 JSON에만`
      + ' 반영돼 있다. **아래에 없는 발화를 인용하거나 원문을 지어내지 마라.**)',
    );
  }
  return lines.join('\n');
}

/**
 * 한 턴의 사용자 메시지 본문을 만든다.
 * 시스템 지침은 별도 필드(system_instruction)로 나가므로 여기 포함하지 않는다.
 */
export function buildTurnPrompt(state: PRDState, userInput: string): string {
  return [
    '## 현재 PRD 상태 JSON',
    '```json',
    JSON.stringify(stateForPrompt(state), null, 1),
    '```',
    '',
    `## 직전 대화 (최근 ${MAX_HISTORY_TURNS}턴)`,
    renderHistory(
      recentHistory(state.history),
      Math.max(0, state.history.length - MAX_HISTORY_TURNS),
    ),
    '',
    '## 사용자 최신 입력',
    userInput,
  ].join('\n');
}

/**
 * 상태가 컨텍스트 한계에 가까워지면 가장 오래된 history부터 버린다 — 스펙 §11.
 * **섹션 content는 절대 제거하지 않는다.** 그것이 문서의 본체다.
 */
export function trimHistory(state: PRDState, keep: number): PRDState {
  if (state.history.length <= keep) return state;
  return { ...state, history: state.history.slice(-keep) };
}
