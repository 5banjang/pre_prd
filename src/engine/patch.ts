// 패치 연산 정의 — 스펙 §5.2 출력 형식.
//
// LLM은 PRD 전문을 재생성하지 않는다. "어느 섹션을 어떻게 갱신할지"의 연산 목록만 반환한다.
// 여기 정의는 신뢰할 수 없는 입력(LLM 출력)을 다루므로 런타임 검사를 함께 둔다.

import {
  SECTION_IDS,
  type Assumption, type CostLine, type Requirement, type SectionId, type SectionStatus,
} from '../types/prd.js';

export interface SetSectionPatch {
  op: 'set_section';
  id: SectionId;
  content: string;
  status: SectionStatus;
}

export interface AddRequirementPatch {
  op: 'add_requirement';
  requirement: Requirement;
}

export interface AddOpenQuestionPatch {
  op: 'add_open_question';
  text: string;
}

export interface AddCostLinePatch {
  op: 'add_cost_line';
  line: CostLine;
}

/**
 * 사용자가 "모르겠어요"를 눌러 엔진이 대신 정한 값 — 개정안 #02 §B5-2.
 * 진행은 뚫리되 **무엇을 앱이 정했는지 문서에 남는다.**
 */
export interface AddAssumptionPatch {
  op: 'add_assumption';
  assumption: Assumption;
}

export interface AddUnverifiedPatch {
  op: 'add_unverified';
  term: string;
}

export type Patch =
  | SetSectionPatch
  | AddRequirementPatch
  | AddOpenQuestionPatch
  | AddCostLinePatch
  | AddAssumptionPatch
  | AddUnverifiedPatch;

// --- 런타임 검사 ------------------------------------------------------------

const SECTION_ID_SET = new Set<string>(SECTION_IDS);
const STATUSES = new Set<string>(['empty', 'drafting', 'confirmed']);
const PRIORITIES = new Set<string>(['Must', 'Should', 'Could']);
const ASSUMPTION_SOURCES = new Set<string>(['user', 'default', 'inferred']);

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

export function isSectionId(v: unknown): v is SectionId {
  return typeof v === 'string' && SECTION_ID_SET.has(v);
}

export function isRequirement(v: unknown): v is Requirement {
  if (!isRecord(v)) return false;
  return (
    typeof v.id === 'string' && v.id.length > 0 &&
    typeof v.title === 'string' &&
    typeof v.description === 'string' &&
    isStringArray(v.acceptanceCriteria) &&
    typeof v.priority === 'string' && PRIORITIES.has(v.priority) &&
    isStringArray(v.dependsOn) &&
    (v.section === 'FR' || v.section === 'NFR')
  );
}

export function isCostLine(v: unknown): v is CostLine {
  if (!isRecord(v)) return false;
  return (
    typeof v.item === 'string' &&
    typeof v.unit === 'string' &&
    typeof v.estimatedCost === 'number' && Number.isFinite(v.estimatedCost) &&
    typeof v.verified === 'boolean' &&
    typeof v.note === 'string'
  );
}

export function isAssumption(v: unknown): v is Assumption {
  if (!isRecord(v)) return false;
  return (
    typeof v.text === 'string' && v.text.trim().length > 0 &&
    typeof v.source === 'string' && ASSUMPTION_SOURCES.has(v.source)
  );
}

/** 알 수 없는 op이나 형식 위반은 여기서 걸러진다. 앱이 죽지 않는다 — FR-003. */
export function isPatch(v: unknown): v is Patch {
  if (!isRecord(v)) return false;
  switch (v.op) {
    case 'set_section':
      return isSectionId(v.id) && typeof v.content === 'string' &&
        typeof v.status === 'string' && STATUSES.has(v.status);
    case 'add_requirement':
      return isRequirement(v.requirement);
    case 'add_open_question':
      return typeof v.text === 'string' && v.text.trim().length > 0;
    case 'add_cost_line':
      return isCostLine(v.line);
    case 'add_assumption':
      return isAssumption(v.assumption);
    case 'add_unverified':
      return typeof v.term === 'string' && v.term.trim().length > 0;
    default:
      return false;
  }
}
