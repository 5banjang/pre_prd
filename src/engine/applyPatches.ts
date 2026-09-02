// 패치 적용 엔진 — 스펙 FR-003.
//
// 순수 함수다. 입력 상태를 변형하지 않고 새 상태를 돌려준다.
// LLM 출력은 신뢰할 수 없으므로 형식 위반은 버리되 앱이 죽지 않아야 한다.

import { SECTION_DEFS, type PRDState, type Section, type SectionId } from '../types/prd.js';
import { isPatch, isSectionId, type Patch } from './patch.js';

/** 적용되지 않은 패치와 그 이유. UI가 사용자에게 알리는 데 쓴다. */
export interface RejectedPatch {
  reason: 'unknown_op' | 'unknown_section' | 'section_locked' | 'malformed';
  /** **화면에 뜨는 문구.** 내부 값(섹션 ID, op 이름)을 넣지 않는다 — 사용자가 고칠 게 아니다. */
  message: string;
  /** 콘솔·디버깅용 상세. 원인 추적에 필요한 원본 값이 여기 들어간다. */
  detail?: string;
  sectionId?: SectionId;
  patch: unknown;
}

export interface ApplyResult {
  state: PRDState;
  applied: number;
  rejected: RejectedPatch[];
}

export interface ApplyOptions {
  /** 콘솔 경고 대신 다른 곳으로 흘려보내고 싶을 때 (테스트용) */
  onWarn?: (message: string) => void;
}

/**
 * 패치 목록을 상태에 적용한다.
 *
 * - `set_section`은 content를 **교체**한다. 이어붙이지 않는다 (스펙 §5.3).
 * - `locked: true`인 섹션은 거부한다 — 사용자 편집 보호 (§13 Q2).
 * - 알 수 없는 op·섹션 ID는 무시하고 경고를 남긴다. 앱은 계속 동작한다 (FR-003, §11).
 * - 중복 요구사항 ID는 기존 항목을 덮어쓴다 (FR-003).
 */
export function applyPatches(
  state: PRDState,
  patches: readonly unknown[],
  opts: ApplyOptions = {},
): ApplyResult {
  const warn = opts.onWarn ?? ((m: string) => console.warn(`[applyPatches] ${m}`));
  const rejected: RejectedPatch[] = [];
  let applied = 0;

  // 얕은 복사 후 건드리는 가지만 새로 만든다 — 입력 상태는 변형하지 않는다
  const sections = { ...state.sections };
  const requirements = [...state.requirements];
  const openQuestions = [...state.openQuestions];
  const costModel = [...state.costModel];
  const unverifiedTerms = [...state.unverifiedTerms];

  const reject = (r: RejectedPatch) => {
    rejected.push(r);
    // 콘솔에는 원본 값을 남긴다. 화면 문구를 다듬는다고 진단이 사라지면 안 된다.
    warn(r.detail ?? r.message);
  };

  for (const raw of patches) {
    if (!isPatch(raw)) {
      const bad = raw as { op?: unknown; id?: unknown } | null;
      const op = bad?.op;

      // 섹션 ID 오류는 따로 구분한다 — UI 메시지가 달라야 한다 (스펙 §11)
      if (op === 'set_section' && !isSectionId(bad?.id)) {
        reject({
          reason: 'unknown_section',
          message: '엔진이 없는 항목을 가리켜 무시했습니다. 다시 시도하면 대개 해결됩니다.',
          detail: `존재하지 않는 섹션 ID: "${String(bad?.id)}"`,
          patch: raw,
        });
        continue;
      }

      const known = typeof op === 'string';
      reject({
        reason: known ? 'unknown_op' : 'malformed',
        // 엔진 출력 형식 오류다. 사용자가 고칠 수 있는 게 아니므로 내부 값을 보여주지 않는다.
        message: '엔진 응답 일부를 알아볼 수 없어 건너뛰었습니다. 문서는 그대로입니다.',
        detail: known ? `알 수 없는 op: "${op}"` : '패치 형식 위반',
        patch: raw,
      });
      continue;
    }

    const patch: Patch = raw;

    switch (patch.op) {
      case 'set_section': {
        const current = sections[patch.id] as Section | undefined;
        if (!current) {
          // isPatch가 걸러주지만 방어적으로 남긴다 — 스펙 §11
          reject({
            reason: 'unknown_section',
            message: '엔진이 없는 항목을 가리켜 무시했습니다. 다시 시도하면 대개 해결됩니다.',
            detail: `존재하지 않는 섹션 ID: "${patch.id}"`,
            patch,
          });
          break;
        }
        if (current.locked) {
          reject({
            reason: 'section_locked',
            sectionId: patch.id,
            message: `'${SECTION_DEFS[patch.id].label}'은 직접 편집하신 항목이라 엔진이 덮어쓰지 못하게 막았습니다.`,
            patch,
          });
          break;
        }
        sections[patch.id] = {
          ...current,
          content: patch.content,
          status: patch.status,
          updatedAtTurn: state.turn,
        };
        applied += 1;
        break;
      }

      case 'add_requirement': {
        const incoming = patch.requirement;
        const at = requirements.findIndex((r) => r.id === incoming.id);
        if (at >= 0) requirements[at] = incoming; // 중복 ID는 덮어쓴다
        else requirements.push(incoming);
        applied += 1;
        break;
      }

      case 'add_open_question': {
        const text = patch.text.trim();
        if (!openQuestions.includes(text)) openQuestions.push(text);
        applied += 1;
        break;
      }

      case 'add_cost_line': {
        costModel.push(patch.line);
        applied += 1;
        break;
      }

      case 'add_unverified': {
        const term = patch.term.trim();
        if (!unverifiedTerms.includes(term)) unverifiedTerms.push(term);
        applied += 1;
        break;
      }
    }
  }

  return {
    state: { ...state, sections, requirements, openQuestions, costModel, unverifiedTerms },
    applied,
    rejected,
  };
}

/** 사용자가 섹션을 직접 편집해 저장한다 — FR-007. 저장과 동시에 잠긴다. */
export function editSection(state: PRDState, id: SectionId, content: string): PRDState {
  const current = state.sections[id];
  return {
    ...state,
    sections: {
      ...state.sections,
      [id]: { ...current, content, updatedAtTurn: state.turn, locked: true },
    },
  };
}

/** 사용자가 잠금을 푼다. 이후 엔진 패치가 다시 적용된다 — FR-007. */
export function unlockSection(state: PRDState, id: SectionId): PRDState {
  return {
    ...state,
    sections: { ...state.sections, [id]: { ...state.sections[id], locked: false } },
  };
}
