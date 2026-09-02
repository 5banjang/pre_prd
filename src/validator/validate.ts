// 완성도 검증기 — 스펙 §6 + 개정안 #02 §A.
//
// 이 앱의 최종 판단자다. LLM이 "완성되었습니다"라고 말해도 여기가 미완성이라 하면 미완성이다.
// 다만 판단의 결과는 **차단이 아니라 고지**다 — 내보내기를 막지 않는다.
// 무엇이 비었는지 내보내기 직전 점검 화면(FR-005)에 전부 보여주고, 뽑을지는 사용자가 정한다.
// 대신 남은 항목은 산출물에 '미정'으로 반드시 남는다.
//
// 순수 함수로 구현한다. LLM을 호출하지 않는다.

import { KRW_PER_USD } from '../config.js';
import { SECTION_DEFS, SECTION_IDS, STATUS_LABEL, type PRDState, type SectionId } from '../types/prd.js';
import { findUntaggedVendorTerms } from './vendorDict.js';

export interface ValidationIssue {
  severity: 'incomplete' | 'warn';
  code: string;
  message: string;
  sectionId?: SectionId;
}

/** 필수 섹션의 최소 분량 (스펙 §6.1 MISSING_SECTION) */
const MIN_SECTION_CHARS = 200;

// --- §6.2 AC 검증 ----------------------------------------------------------

/** 숫자 + 단위 — "3초 이내", "100건", "4,000자" */
const HAS_MEASURE = /\d[\d,.]*\s*(초|분|시간|일|개|건|회|자|%|퍼센트|ms|s|kb|mb|gb|턴|명|원|달러|\$)/i;

// 조건절 — "~하면", "~일 때", "~인 경우", "실패 시"
// 주의 1: JS의 \b는 ASCII 기준이라 한글 뒤에서 절대 매칭되지 않는다. 단어 경계를 쓰지 않는다.
// 주의 2: 조사 없는 "시"는 앞에 공백을 요구한다. 그래야 "표시"·"제시"의 '시'에 걸리지 않는다.
const HAS_CONDITION =
  /(하면|되면|이면|일 때|경우|초과|미만|이상|이하|없으면|있으면|없을 때|있을 때|시에|\s시(\s|$|[,.]))/;

// 관찰 가능 동작 — 결과를 눈으로 확인할 수 있는 서술.
//
// 어간과 어미를 분리한다. 실제 AC는 "반환한다"뿐 아니라 "반환해야 함", "합성되어야 함",
// "재합성 가능" 처럼 명사형·당위형으로도 쓰인다. 종결형만 매칭하면 정상 AC가 대량 오차단된다.
//
// 범용 동사(제공·동작·지원·구현)는 일부러 뺐다. 스펙 §6.2가 차단 대상으로 명시한
// "직관적인 UI를 제공한다", "안정적으로 동작한다"가 통과해버리기 때문이다.
const OBSERVABLE_STEMS = [
  '표시', '노출', '출력', '표출', '렌더', '나타',
  '저장', '기록', '등록', '삭제', '제거', '복원', '갱신', '수정', '초기화', '동기화',
  '차단', '거부', '무시', '잠금', '해제', '차감', '충전', '적립',
  '반환', '응답', '전송', '발송', '수신', '호출', '재시도', '리다이렉트',
  '생성', '합성', '변환', '계산', '집계', '검증', '조회', '검색', '정렬', '필터',
  '활성화', '비활성화', '이동', '포함', '다운로드', '업로드', '복사', '내보내',
].join('|');
const OBSERVABLE_ENDINGS =
  '된다|한다|됩니다|합니다|되어야|해야|되며|하며|되고|하고|된|한|됨|함|가능|불가|되지|하지|되면|하면';
// `-링`은 영어 -ing를 들여온 한국어 접미사이며 매우 규칙적이다(렌더링·필터링·스크롤링).
// 이걸 허용하지 않으면 `렌더된다`는 통과하는데 **`렌더링된다`가 차단된다.**
// M7 실사용에서 정상 AC가 이것 때문에 막혔다.
const HAS_OBSERVABLE = new RegExp(`(${OBSERVABLE_STEMS})(링)?\\s*(${OBSERVABLE_ENDINGS})`);

/**
 * AC 한 줄이 검증 가능한지 판단한다 — 스펙 §6.2.
 * 차단 대상 예시: "사용자 경험을 극대화한다", "안정적으로 동작한다", "직관적인 UI를 제공한다"
 */
export function isTestableAC(ac: string): boolean {
  const t = ac.trim();
  if (t.length === 0) return false;
  return HAS_MEASURE.test(t) || HAS_CONDITION.test(t) || HAS_OBSERVABLE.test(t);
}

// --- 보조 파서 -------------------------------------------------------------

/** 마크다운 리스트/표 항목 수를 센다. S7 엣지 케이스 계수용. */
export function countListItems(markdown: string): number {
  let count = 0;
  for (const raw of markdown.split('\n')) {
    const line = raw.trim();
    if (/^([-*+]|\d+\.)\s+\S/.test(line)) count += 1;
    // 표 행 — 헤더와 구분선은 제외
    else if (/^\|.*\|$/.test(line) && !/^\|[\s:|-]+\|$/.test(line)) count += 1;
  }
  // 표를 썼다면 헤더 행 1개를 항목에서 뺀다
  if (/^\|[\s:|-]+\|$/m.test(markdown)) count -= 1;
  return Math.max(0, count);
}

/** S9에 가격·요금제 언급이 있는가 — MONETIZATION_NO_COST 판정용 */
const MONETIZATION_RE =
  /(요금제|가격|과금|구독|결제|유료|월 ?\d|₩\s?\d|\$\s?\d|무료 ?체험|프리미엄|플랜)/;

/**
 * S0 Builder Context에서 예산 상한을 USD로 읽는다.
 * 찾지 못하면 null — 상한이 없으면 초과도 없다.
 * 환율은 `config.ts`의 `KRW_PER_USD`를 쓴다 (TODO: 사용자 확인 필요).
 */
export { KRW_PER_USD } from '../config.js';

export function parseBudgetUSD(s0Content: string): number | null {
  const usd = /\$\s?([\d,]+(?:\.\d+)?)/.exec(s0Content);
  if (usd?.[1]) return Number(usd[1].replace(/,/g, ''));

  const krw = /(?:₩\s?([\d,]+)|([\d,]+)\s*원)/.exec(s0Content);
  const amount = krw?.[1] ?? krw?.[2];
  if (amount) return Number(amount.replace(/,/g, '')) / KRW_PER_USD;

  return null;
}

// --- 검증기 본체 -----------------------------------------------------------

export function validate(state: PRDState): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const add = (i: ValidationIssue) => issues.push(i);

  /*
   * 섹션 상태 — **미정은 진짜 빈 곳에만 붙인다.**
   *
   * 빌더 지시(2026-09-03): "글자수가 안 채워졌어도 PRD 문서에 내용을 넣어야지."
   * 전에는 186자짜리 섹션이 200자에 14자 못 미친다는 이유로 '미정'으로 분류됐다.
   * 내용이 멀쩡히 있는데 산출물 맨 위 미정 목록에 오르면 개발 AI가 그 항목을
   * 비어 있는 것으로 읽는다. 그것이야말로 이 앱이 막으려던 일이다.
   *
   * 그래서 세 갈래로 나눈다 — 원칙 4의 선(빈 곳은 반드시 남는다)은 그대로다.
   *   본문 없음        → 미정 (incomplete)
   *   본문 있고 짧음    → 경고 (warn) · 문서에는 그대로 실린다
   *   본문 있고 확정 전 → 경고 (warn) · 문서에는 그대로 실린다
   */
  for (const id of SECTION_IDS) {
    const s = state.sections[id];
    if (!s.required) continue;
    const body = s.content.trim();

    if (body === '') {
      add({
        severity: 'incomplete',
        code: 'MISSING_SECTION',
        sectionId: id,
        message: '아직 비어 있습니다',
      });
    } else if (body.length < MIN_SECTION_CHARS) {
      add({
        severity: 'warn',
        code: 'SECTION_THIN',
        sectionId: id,
        message: `내용이 짧습니다 (${body.length}자 / 권장 ${MIN_SECTION_CHARS}자). 문서에는 그대로 실립니다`,
      });
    } else if (s.status !== 'confirmed') {
      add({
        severity: 'warn',
        code: 'SECTION_UNCONFIRMED',
        sectionId: id,
        message: `아직 확정 전입니다 (현재 ${STATUS_LABEL[s.status]}). 문서에는 그대로 실립니다`,
      });
    }
  }

  const frs = state.requirements.filter((r) => r.section === 'FR');
  const nfrs = state.requirements.filter((r) => r.section === 'NFR');

  // NO_FR — FR 3개 미만
  if (frs.length < 3) {
    add({
      severity: 'incomplete',
      code: 'NO_FR',
      sectionId: 'S5',
      message: `기능 요구사항이 부족합니다 (${frs.length}개 / 최소 3개)`,
    });
  }

  // FR_NO_AC — AC 2개 미만인 FR
  for (const fr of frs) {
    if (fr.acceptanceCriteria.length < 2) {
      add({
        severity: 'incomplete',
        code: 'FR_NO_AC',
        sectionId: 'S5',
        message: `${fr.id}: 인수 조건이 부족합니다 (${fr.acceptanceCriteria.length}개 / 최소 2개)`,
      });
    }
  }

  // AC_NOT_TESTABLE — 측정 불가능한 AC — §6.2
  for (const req of state.requirements) {
    for (const ac of req.acceptanceCriteria) {
      if (!isTestableAC(ac)) {
        add({
          severity: 'incomplete',
          code: 'AC_NOT_TESTABLE',
          sectionId: req.section === 'FR' ? 'S5' : 'S6',
          message: `${req.id}: 검증 불가능한 인수 조건 — "${ac.trim()}". 숫자·조건절·관찰 가능한 동작 중 하나가 필요합니다`,
        });
      }
    }
  }

  // NO_NFR — NFR 4개 미만 (보안/개인정보/성능/에러처리)
  if (nfrs.length < 4) {
    add({
      severity: 'incomplete',
      code: 'NO_NFR',
      sectionId: 'S6',
      message: `비기능 요구사항이 부족합니다 (${nfrs.length}개 / 최소 4개 — 보안·개인정보·성능·에러처리)`,
    });
  }

  // FEW_EDGE_CASES — S7 항목 5개 미만
  const edgeCount = countListItems(state.sections.S7.content);
  if (edgeCount < 5) {
    add({
      severity: 'incomplete',
      code: 'FEW_EDGE_CASES',
      sectionId: 'S7',
      message: `엣지 케이스가 부족합니다 (${edgeCount}개 / 최소 5개)`,
    });
  }

  // FEW_OPEN_QUESTIONS — 5개 미만
  if (state.openQuestions.length < 5) {
    add({
      severity: 'incomplete',
      code: 'FEW_OPEN_QUESTIONS',
      sectionId: 'S10',
      message: `미해결 질문이 부족합니다 (${state.openQuestions.length}개 / 최소 5개)`,
    });
  }

  // MONETIZATION_NO_COST — S9에 가격 언급이 있는데 원가표가 비어 있음
  const s9 = state.sections.S9;
  if (MONETIZATION_RE.test(s9.content) && state.costModel.length === 0) {
    add({
      severity: 'incomplete',
      code: 'MONETIZATION_NO_COST',
      sectionId: 'S9',
      message: '가격·요금제 얘기가 있는데 원가표가 비어 있습니다',
    });
  }

  // UNTAGGED_PROPER_NOUN — §6.3
  for (const id of SECTION_IDS) {
    const s = state.sections[id];
    for (const hit of findUntaggedVendorTerms(s.content)) {
      add({
        severity: 'incomplete',
        code: 'UNTAGGED_PROPER_NOUN',
        sectionId: id,
        message: `${id}: "${hit.term}"에 [미검증] 태그나 출처가 없습니다 — "${hit.sentence}"`,
      });
    }
  }

  // BUDGET_OVERRUN — 원가 합계가 S0 예산 상한 초과
  const budget = parseBudgetUSD(state.sections.S0.content);
  if (budget !== null && state.costModel.length > 0) {
    const total = state.costModel.reduce((sum, l) => sum + l.estimatedCost, 0);
    if (total > budget) {
      add({
        severity: 'incomplete',
        code: 'BUDGET_OVERRUN',
        sectionId: 'S9',
        message: `원가 합계 $${total.toFixed(2)}가 적어둔 예산 $${budget.toFixed(2)}를 넘습니다`,
      });
    }
  }

  // --- §6.4 경고 규칙 — 내보내기는 허용 ---

  if (frs.length > 12) {
    add({
      severity: 'warn',
      code: 'TOO_MANY_FR',
      sectionId: 'S5',
      message: `기능이 많습니다 (${frs.length}개 / 권장 12개 이하). 일부를 '${SECTION_DEFS.S3.label}'으로 미루는 것을 검토하세요`,
    });
  }

  const inferred = state.assumptions.filter((a) => a.source === 'inferred').length;
  if (inferred > 5) {
    add({
      severity: 'warn',
      code: 'TOO_MANY_INFERRED',
      sectionId: 'S10',
      message: `추론으로 채운 가정이 많습니다 (${inferred}개 / 권장 5개 이하). 사용자 확인이 필요합니다`,
    });
  }

  for (const id of SECTION_IDS) {
    const s = state.sections[id];
    if (s.status === 'empty' && state.turn - s.updatedAtTurn >= 20) {
      add({
        severity: 'warn',
        code: 'SECTION_STALE',
        sectionId: id,
        message: `${state.turn - s.updatedAtTurn}턴째 비어 있습니다`,
      });
    }
  }

  return issues;
}

export interface Completeness {
  /** 아직 채워지지 않은 항목 수 */
  incomplete: number;
  /** 알고 넘어가도 되는 항목 수 */
  warn: number;
  /** 검사한 규칙 수 */
  checked: number;
  /** 0~100. 헤더 진행률 표시용 — 개정안 #02 §B5-1 */
  percent: number;
}

/**
 * 검사한 규칙 대비 통과 비율.
 *
 * `validate()`는 위반한 것만 돌려주므로 분모를 따로 세야 한다.
 * 규칙 하나가 여러 섹션에서 각각 걸리므로(예: MISSING_SECTION) 분모는 고정 상수가 아니라
 * "검사 대상 수 = 통과 + 위반"으로 잡는다. 섹션 11개 + 요구사항별 검사 + 전역 규칙.
 */
export function completeness(state: PRDState): Completeness {
  const issues = validate(state);
  const incomplete = issues.filter((i) => i.severity === 'incomplete').length;
  const warn = issues.filter((i) => i.severity === 'warn').length;

  // 분모: 필수 섹션 수 + 전역 차단 규칙 수(NO_FR·NO_NFR·FEW_OPEN_QUESTIONS·FEW_EDGE_CASES 등 8) + 요구사항 수
  const required = SECTION_IDS.filter((id) => state.sections[id].required).length;
  const checked = required + 8 + state.requirements.length;

  /*
   * 내용은 있는데 아직 확정 전인 섹션은 **절반만** 쳐준다.
   *
   * 실측(2026-09-02): 자료를 첨부해 8개 섹션이 한꺼번에 초안으로 채워졌는데 완성도가
   * 21% → 9%로 **떨어졌다.** 빈 섹션과 초안 섹션을 똑같이 0점으로 보는 사이,
   * 요구사항이 등록되며 분모만 늘었기 때문이다. 진척이 후퇴로 보이면 숫자가 거짓말을 한다.
   * 이슈 목록과 점검 화면은 그대로 전부 보여주므로 고지가 약해지지는 않는다.
   */
  const drafting = SECTION_IDS.filter((id) => {
    const s = state.sections[id];
    return s.required && s.status !== 'confirmed' && s.content.trim() !== '';
  }).length;

  const earned = checked - incomplete + drafting * 0.5;
  const percent = checked === 0 ? 0
    : Math.min(100, Math.max(0, Math.round((earned / checked) * 100)));

  return { incomplete, warn, checked, percent };
}
