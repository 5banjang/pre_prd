// PRD 상태 모델 — 스펙 §4.
// 이 앱의 진실은 PRDState 객체 하나다. LLM은 상태를 기억하지 않고 매 턴 이것을 다시 받는다.

export type SectionId =
  | 'S0' | 'S1' | 'S2' | 'S3' | 'S4' | 'S5'
  | 'S6' | 'S7' | 'S8' | 'S9' | 'S10' | 'S11';

export type SectionStatus = 'empty' | 'drafting' | 'confirmed';

export interface Section {
  id: SectionId;
  title: string;
  required: boolean;
  status: SectionStatus;
  /** 마크다운. 이것이 최종 문서에 그대로 들어간다. */
  content: string;
  updatedAtTurn: number;
  /** 사용자가 직접 편집(FR-007)하면 true. 엔진의 set_section을 거부한다 — §13 Q2 */
  locked: boolean;
}

export interface Requirement {
  /** "FR-001" | "NFR-001" */
  id: string;
  title: string;
  description: string;
  /** 최소 2개. 검증 가능한 문장만 — §6.2 */
  acceptanceCriteria: string[];
  priority: 'Must' | 'Should' | 'Could';
  dependsOn: string[];
  section: 'FR' | 'NFR';
}

export interface CostLine {
  /** "LLM 호출 (인터뷰 1세션)" */
  item: string;
  /** "세션당" */
  unit: string;
  estimatedCost: number;
  /** 실제 가격표 확인 여부 */
  verified: boolean;
  note: string;
}

export interface Assumption {
  text: string;
  source: 'user' | 'default' | 'inferred';
}

export interface HistoryEntry {
  turn: number;
  role: 'user' | 'engine';
  text: string;
}

export interface PRDState {
  /** 영속화 마이그레이션 기준점 (v3.1). 현재 1 */
  schemaVersion: number;
  projectName: string;
  version: string;
  turn: number;
  sections: Record<SectionId, Section>;
  requirements: Requirement[];
  /** 수익화 섹션(S9)이 있으면 필수 */
  costModel: CostLine[];
  /** 최소 5개 필요 */
  openQuestions: string[];
  assumptions: Assumption[];
  /** [미검증] 태그가 붙은 고유명사 수집 */
  unverifiedTerms: string[];
  history: HistoryEntry[];
}

// --- 섹션 정의 — 스펙 §4.2 -------------------------------------------------

interface SectionDef {
  title: string;
  /** S9는 조건부 필수(수익 모델 언급 시)이므로 false. §6.1 MONETIZATION_NO_COST가 별도로 잡는다. */
  required: boolean;
}

export const SECTION_DEFS: Record<SectionId, SectionDef> = {
  S0: { title: 'Builder Context', required: true },
  S1: { title: 'Project Overview', required: true },
  S2: { title: 'MVP Scope (In)', required: true },
  S3: { title: 'Out of Scope', required: true },
  S4: { title: 'User Stories & Flow', required: true },
  S5: { title: 'Functional Requirements', required: true },
  S6: { title: 'Non-Functional Requirements', required: true },
  S7: { title: 'Edge Cases & Failure Scenarios', required: true },
  S8: { title: 'Tech Stack & Constraints', required: true },
  S9: { title: 'Cost & Monetization', required: false },
  S10: { title: 'Open Questions & Assumptions', required: true },
  S11: { title: 'Deployment & Operations', required: true },
};

export const SECTION_IDS = Object.keys(SECTION_DEFS) as SectionId[];

export function createEmptySections(): Record<SectionId, Section> {
  const out = {} as Record<SectionId, Section>;
  for (const id of SECTION_IDS) {
    const def = SECTION_DEFS[id];
    out[id] = {
      id,
      title: def.title,
      required: def.required,
      status: 'empty',
      content: '',
      updatedAtTurn: 0,
      locked: false,
    };
  }
  return out;
}

export function createEmptyState(projectName = ''): PRDState {
  return {
    schemaVersion: 1,
    projectName,
    version: '0.1.0',
    turn: 0,
    sections: createEmptySections(),
    requirements: [],
    costModel: [],
    openQuestions: [],
    assumptions: [],
    unverifiedTerms: [],
    history: [],
  };
}
