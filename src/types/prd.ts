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

export type AttachmentKind = 'document' | 'audio';

/**
 * 첨부 1건의 **흔적** — 개정안 #02 §B1.
 *
 * 원본 바이트는 여기 없고 어디에도 저장하지 않는다. 한 번 읽어 섹션에 반영한 뒤 버린다.
 * 첨부를 대화 컨텍스트에 남기면 매 턴 재전송돼 비용이 턴 수에 비례해 폭증한다.
 */
export interface AttachmentRecord {
  id: string;
  kind: AttachmentKind;
  /** 파일명. 원본 바이트는 저장하지 않는다. */
  name: string;
  bytes: number | null;
  extractedAtTurn: number;
  /** 이 첨부 1건이 쓴 토큰 — FR-012 누적에 합산된다 */
  tokensUsed: number;
  /** 엔진이 요약한 한 문단. 원문이 아니다. */
  summary: string;
  touchedSections: SectionId[];
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
  /** 읽어들인 자료의 흔적. 원본은 남지 않는다 — 개정안 §B1 */
  attachments: AttachmentRecord[];
  history: HistoryEntry[];
}

// --- 섹션 정의 — 스펙 §4.2 -------------------------------------------------

interface SectionDef {
  /**
   * 스펙 §4.2의 정식 명칭. **개발 AI용 산출물에 그대로 나간다** — ID와 함께
   * 안정적인 참조 키 역할을 하므로 번역하지 않는다.
   */
  title: string;
  /**
   * 화면에 보이는 이름. 사용자는 `S7`이나 `Edge Cases`가 뭔지 알 필요가 없다.
   * ID는 부차 정보로 작게 남기고 이것을 앞세운다.
   */
  label: string;
  /** 이 섹션에 뭘 쓰는 곳인지 한 줄. 빈 섹션에서 특히 필요하다. */
  hint: string;
  /** S9는 조건부 필수(수익 모델 언급 시)이므로 false. §6.1 MONETIZATION_NO_COST가 별도로 잡는다. */
  required: boolean;
}

export const SECTION_DEFS: Record<SectionId, SectionDef> = {
  S0: {
    title: 'Builder Context', label: '만드는 사람의 조건', required: true,
    hint: '예산, 가진 API 키, 배포할 곳, 쓸 수 있는 시간. 이게 정해져야 나머지 범위를 자를 수 있다.',
  },
  S1: {
    title: 'Project Overview', label: '제품 한 줄 정의', required: true,
    hint: '무엇을, 누구에게, 왜 만드는가.',
  },
  S2: {
    title: 'MVP Scope (In)', label: '만들 것', required: true,
    hint: '이번 버전에 반드시 들어가는 기능.',
  },
  S3: {
    title: 'Out of Scope', label: '만들지 않을 것', required: true,
    hint: '좋은 아이디어여도 이번엔 빼는 것. 개발 AI가 이 목록을 보고 멈춘다.',
  },
  S4: {
    title: 'User Stories & Flow', label: '사용자 흐름', required: true,
    hint: '사용자가 무엇을 어떤 순서로 하는가.',
  },
  S5: {
    title: 'Functional Requirements', label: '기능 요구사항', required: true,
    hint: '앱이 해야 하는 일. FR-001처럼 번호를 매기고 각각에 인수 기준을 단다.',
  },
  S6: {
    title: 'Non-Functional Requirements', label: '품질 요구사항', required: true,
    hint: '기능이 아닌 조건 — 보안, 개인정보, 성능, 에러 처리.',
  },
  S7: {
    title: 'Edge Cases & Failure Scenarios', label: '예외와 실패 상황', required: true,
    hint: '잘못될 수 있는 상황과, 그때 앱이 어떻게 반응할지.',
  },
  S8: {
    title: 'Tech Stack & Constraints', label: '기술 스택과 제약', required: true,
    hint: '무엇으로 만드는가. 바꿀 수 없는 조건과 바꿔도 되는 제안을 구분해 적는다.',
  },
  S9: {
    title: 'Cost & Monetization', label: '비용과 수익 모델', required: false,
    hint: '돈이 얼마 드는가. 요금을 받는다면 그 구조. 수익 얘기를 꺼내면 원가표가 필수가 된다.',
  },
  S10: {
    title: 'Open Questions & Assumptions', label: '미해결 질문과 가정', required: true,
    hint: '아직 못 정한 것과, 몰라서 임의로 가정한 것. 숨기지 않고 남긴다.',
  },
  S11: {
    title: 'Deployment & Operations', label: '배포와 운영', required: true,
    hint: '어디에 올리고 어떻게 굴리는가. 환경변수, 로깅, 백업.',
  },
};

/** 화면용 이름. `S7` 대신 이것을 앞세운다. */
export function sectionLabel(id: SectionId): string {
  return SECTION_DEFS[id].label;
}

/** 상태를 사람 말로. `drafting` 같은 내부 값을 화면에 그대로 내보내지 않는다. */
export const STATUS_LABEL: Record<SectionStatus, string> = {
  empty: '비어 있음',
  drafting: '초안',
  confirmed: '확정',
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
    attachments: [],
    history: [],
  };
}
