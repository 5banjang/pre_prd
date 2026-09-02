import { describe, it, expect } from 'vitest';
import {
  validate,
  completeness,
  isTestableAC,
  countListItems,
  parseBudgetUSD,
  KRW_PER_USD,
} from './validate.js';
import { createEmptyState, type PRDState, type Requirement } from '../types/prd.js';

// --- 픽스처 ---------------------------------------------------------------
// 모든 차단 규칙을 통과하는 상태를 만들고, 각 테스트가 하나씩만 망가뜨린다.

/** 필수 섹션 최소 분량(200자)을 넘기는 더미 본문. 벤더 고유명사를 포함하지 않는다. */
const filler =
  '이 섹션은 검증기 테스트를 위한 충분한 분량의 내용을 담고 있습니다. ' +
  '실제 문서에서는 인터뷰를 통해 확정된 내용이 마크다운으로 들어갑니다. ' +
  '최소 분량 기준을 넘기기 위해 설명을 이어 붙입니다. 이 문장들은 벤더 고유명사를 포함하지 않습니다. ' +
  '따라서 미검증 태그 규칙에는 걸리지 않아야 합니다. 분량은 이백 자를 넘어갑니다. ' +
  '검증기는 이 본문을 정상으로 판정해야 하며, 어떤 차단 이슈도 만들어내지 않아야 합니다.';

function fr(id: string, overrides: Partial<Requirement> = {}): Requirement {
  return {
    id,
    title: `요구사항 ${id}`,
    description: '설명',
    acceptanceCriteria: ['전송하면 3초 이내에 응답이 표시된다', '실패한 경우 오류 메시지가 노출된다'],
    priority: 'Must',
    dependsOn: [],
    section: 'FR',
    ...overrides,
  };
}

function nfr(id: string, overrides: Partial<Requirement> = {}): Requirement {
  return { ...fr(id), section: 'NFR', ...overrides };
}

/** 차단 이슈가 0개인 상태 */
function validState(): PRDState {
  const s = createEmptyState('테스트 프로젝트');
  s.turn = 10;

  for (const id of Object.keys(s.sections) as (keyof typeof s.sections)[]) {
    s.sections[id].status = 'confirmed';
    s.sections[id].content = filler;
    s.sections[id].updatedAtTurn = 10;
  }

  s.sections.S7.content =
    '- 네트워크가 끊기면 진행 상태가 보존된다\n' +
    '- 키가 무효한 경우 설정 화면으로 이동한다\n' +
    '- 응답이 스키마를 위반하면 재시도한다\n' +
    '- 40턴을 초과하면 경고가 표시된다\n' +
    '- 새로고침하면 마지막 상태가 복원된다\n' + filler;

  s.requirements = [fr('FR-001'), fr('FR-002'), fr('FR-003'),
    nfr('NFR-001'), nfr('NFR-002'), nfr('NFR-003'), nfr('NFR-004')];

  s.openQuestions = ['질문1', '질문2', '질문3', '질문4', '질문5'];
  return s;
}

const codes = (s: PRDState) => validate(s).map((i) => i.code);

// --- 픽스처 자체 검증 ------------------------------------------------------

describe('픽스처', () => {
  it('기본 상태는 차단 이슈가 없다', () => {
    const issues = validate(validState()).filter((i) => i.severity === 'incomplete');
    expect(issues).toEqual([]);
  });

  it('차단 이슈가 없으면 내보내기가 허용된다', () => {
    expect(completeness(validState()).incomplete).toBe(0);
  });
});

// --- 개정안 #02 §A — 검증기는 차단하지 않는다 ------------------------------

describe('M7 회귀 — 명사 접미 -링', () => {
  // M7 실사용에서 실제로 오차단된 AC. `렌더된다`는 통과하는데 `렌더링된다`가 막혔다.
  it.each([
    '매 턴마다 questions 배열의 질문이 카드 형태로 화면에 렌더링된다.',
    '카드가 렌더링됩니다',
    '결과가 필터링된다',
  ])('%s 는 관찰 가능한 AC다', (ac) => {
    expect(isTestableAC(ac)).toBe(true);
  });

  it('접미를 허용해도 범용 동사는 여전히 막힌다', () => {
    // §6.2가 차단 대상으로 명시한 예시들. 이게 뚫리면 수정이 과했다는 뜻이다.
    expect(isTestableAC('사용자 경험을 극대화한다')).toBe(false);
    expect(isTestableAC('안정적으로 동작한다')).toBe(false);
    expect(isTestableAC('직관적인 UI를 제공한다')).toBe(false);
  });
});

describe('원칙 4 개정 — 차단이 아니라 고지', () => {
  it('빈 상태에도 미완성 항목만 쌓일 뿐 차단 수단은 없다', () => {
    // canExport()는 폐기됐다(§A). 내보내기 가부를 묻는 API 자체가 존재하지 않는 것이
    // "항상 가능하다"의 가장 확실한 보장이다.
    const empty = createEmptyState();
    expect(validate(empty).filter((i) => i.severity === 'incomplete').length).toBeGreaterThan(0);
  });

  it("severity에 'block'은 더 이상 없다", () => {
    const severities = new Set(validate(createEmptyState()).map((i) => i.severity));
    expect(severities.has('incomplete' as const)).toBe(true);
    expect([...severities]).not.toContain('block');
  });

  it('빈 상태의 완성도는 완성 상태보다 낮다', () => {
    expect(completeness(createEmptyState()).percent)
      .toBeLessThan(completeness(validState()).percent);
  });

  it('자료를 넣어 초안이 채워지면 완성도가 올라간다 — 떨어지면 안 된다', () => {
    // 실측에서 나온 회귀: 섹션 8개가 초안으로 차고 요구사항 4개가 등록됐는데 21% → 9%였다.
    const before = createEmptyState();
    const after = createEmptyState();
    for (const id of ['S0', 'S1', 'S2', 'S3', 'S8', 'S9', 'S10', 'S11'] as const) {
      after.sections[id] = { ...after.sections[id], content: '자료에서 읽은 내용', status: 'drafting' };
    }
    after.requirements = ['FR-001', 'FR-002', 'FR-003', 'FR-004'].map((id) => ({
      id, title: '제목', description: '설명', acceptanceCriteria: ['조건 시 표시된다', '3초 이내'],
      priority: 'Must' as const, dependsOn: [], section: 'FR' as const,
    }));

    expect(completeness(after).percent).toBeGreaterThan(completeness(before).percent);
  });

  it('완성 상태의 완성도는 100%다', () => {
    expect(completeness(validState()).percent).toBe(100);
  });

  it('완성도는 0~100 범위를 벗어나지 않는다', () => {
    for (const s of [createEmptyState(), validState()]) {
      const c = completeness(s);
      expect(c.percent).toBeGreaterThanOrEqual(0);
      expect(c.percent).toBeLessThanOrEqual(100);
    }
  });
});

// --- §6.1 차단 규칙 10개 — 각각 통과/실패 ----------------------------------

describe('MISSING_SECTION', () => {
  it('실패: 필수 섹션이 confirmed가 아니면 차단', () => {
    const s = validState();
    s.sections.S6.status = 'drafting';
    expect(codes(s)).toContain('MISSING_SECTION');
  });

  it('실패: 필수 섹션이 200자 미만이면 차단', () => {
    const s = validState();
    s.sections.S1.content = '짧음';
    expect(codes(s)).toContain('MISSING_SECTION');
  });

  it('통과: S9는 조건부라 비어 있어도 차단되지 않는다', () => {
    const s = validState();
    s.sections.S9.status = 'empty';
    s.sections.S9.content = '';
    expect(codes(s)).not.toContain('MISSING_SECTION');
  });
});

describe('NO_FR', () => {
  it('실패: FR이 3개 미만', () => {
    const s = validState();
    s.requirements = s.requirements.filter((r) => r.section === 'NFR').concat(fr('FR-001'), fr('FR-002'));
    expect(codes(s)).toContain('NO_FR');
  });

  it('통과: FR이 정확히 3개', () => {
    expect(codes(validState())).not.toContain('NO_FR');
  });
});

describe('FR_NO_AC', () => {
  it('실패: AC가 2개 미만인 FR이 있음', () => {
    const s = validState();
    s.requirements[0]!.acceptanceCriteria = ['전송하면 3초 이내에 표시된다'];
    expect(codes(s)).toContain('FR_NO_AC');
  });

  it('통과: 모든 FR이 AC 2개 이상', () => {
    expect(codes(validState())).not.toContain('FR_NO_AC');
  });
});

describe('AC_NOT_TESTABLE — §6.2', () => {
  it.each([
    '사용자 경험을 극대화한다',
    '안정적으로 동작한다',
    '직관적인 UI를 제공한다',
  ])('실패: "%s"', (ac) => {
    const s = validState();
    s.requirements[0]!.acceptanceCriteria = [ac, ac];
    expect(codes(s)).toContain('AC_NOT_TESTABLE');
  });

  it.each([
    ['숫자+단위', '응답이 3초 이내에 도착한다'],
    ['조건절', '키가 무효한 경우 설정 화면으로 유도한다'],
    ['관찰 가능 동작', '내보내기 버튼이 비활성화된다'],
  ])('통과: %s — "%s"', (_label, ac) => {
    expect(isTestableAC(ac)).toBe(true);
  });

  // 실사용 회귀 — 2026-08-27 빌더 세션에서 정상 AC가 대량 오차단됐다.
  // 원인: 종결형(~한다/~된다)만 매칭해 명사형·당위형 어미를 놓쳤고,
  //      조사 없는 "실패 시" 형태의 조건절을 못 잡았다.
  it.each([
    '호출 실패 시 크레딧을 차감하지 않고 에러를 반환해야 함',
    '신랑/신부 얼굴이 각각 템플릿에 맞게 합성되어야 함',
    '결제 완료 웹훅 수신 시 크레딧 즉시 +N 충전됨',
    '충전된 크레딧으로 템플릿 재합성 가능',
    '업로드한 원본은 24시간 뒤 삭제됨',
  ])('회귀: 명사형·당위형 어미도 통과해야 한다 — "%s"', (ac) => {
    expect(isTestableAC(ac)).toBe(true);
  });

  it('"표시"의 시가 조건절 "시"로 오인되지 않는다', () => {
    // 관찰 동작으로는 통과하지만, 조건절로 통과하는 것은 아니어야 한다
    expect(isTestableAC('추상적인 무언가를 표시')).toBe(false);
  });
});

describe('NO_NFR', () => {
  it('실패: NFR이 4개 미만', () => {
    const s = validState();
    s.requirements = s.requirements.filter((r) => r.section === 'FR').concat(nfr('NFR-001'));
    expect(codes(s)).toContain('NO_NFR');
  });

  it('통과: NFR 4개', () => {
    expect(codes(validState())).not.toContain('NO_NFR');
  });
});

describe('FEW_EDGE_CASES', () => {
  it('실패: S7 항목이 5개 미만', () => {
    const s = validState();
    s.sections.S7.content = '- 하나\n- 둘\n' + filler;
    expect(codes(s)).toContain('FEW_EDGE_CASES');
  });

  it('통과: S7 항목 5개', () => {
    expect(codes(validState())).not.toContain('FEW_EDGE_CASES');
  });

  it('표 형식도 항목으로 센다', () => {
    const s = validState();
    s.sections.S7.content =
      '| 상황 | 기대 동작 |\n|---|---|\n| A | a |\n| B | b |\n| C | c |\n| D | d |\n| E | e |\n' + filler;
    expect(codes(s)).not.toContain('FEW_EDGE_CASES');
  });
});

describe('FEW_OPEN_QUESTIONS', () => {
  it('실패: 5개 미만', () => {
    const s = validState();
    s.openQuestions = ['하나', '둘'];
    expect(codes(s)).toContain('FEW_OPEN_QUESTIONS');
  });

  it('통과: 5개', () => {
    expect(codes(validState())).not.toContain('FEW_OPEN_QUESTIONS');
  });
});

describe('MONETIZATION_NO_COST', () => {
  it('실패: S9에 요금제 언급이 있으나 costModel이 비어 있음', () => {
    const s = validState();
    s.sections.S9.content = '월 구독 요금제를 도입한다. ' + filler;
    expect(codes(s)).toContain('MONETIZATION_NO_COST');
  });

  it('통과: 원가 표가 있으면 허용', () => {
    const s = validState();
    s.sections.S9.content = '월 구독 요금제를 도입한다. ' + filler;
    s.costModel = [{ item: 'LLM 호출', unit: '세션당', estimatedCost: 1.2, verified: true, note: '' }];
    expect(codes(s)).not.toContain('MONETIZATION_NO_COST');
  });

  it('통과: 수익화 언급이 없으면 원가 표가 없어도 무관', () => {
    expect(codes(validState())).not.toContain('MONETIZATION_NO_COST');
  });
});

describe('UNTAGGED_PROPER_NOUN — §6.3', () => {
  it('실패: 태그 없는 벤더 고유명사', () => {
    const s = validState();
    s.sections.S8.content = 'GPT-4를 사용한다. ' + filler;
    expect(codes(s)).toContain('UNTAGGED_PROPER_NOUN');
  });

  it('통과: [미검증] 태그가 같은 문장에 있으면 허용', () => {
    const s = validState();
    s.sections.S8.content = 'GPT-4를 사용한다 [미검증]. ' + filler;
    expect(codes(s)).not.toContain('UNTAGGED_PROPER_NOUN');
  });

  it('통과: 출처 URL이 같은 문장에 있으면 허용', () => {
    const s = validState();
    s.sections.S8.content = 'Claude Opus 5의 단가는 https://claude.com/pricing 참조. ' + filler;
    expect(codes(s)).not.toContain('UNTAGGED_PROPER_NOUN');
  });

  it('오탐 방지: FR-001 같은 요구사항 ID는 잡지 않는다', () => {
    const s = validState();
    s.sections.S5.content = 'FR-001과 FR-002는 S0에 의존한다. ES2022를 대상으로 한다. ' + filler;
    expect(codes(s)).not.toContain('UNTAGGED_PROPER_NOUN');
  });

  // §13 Q4 — 목적은 "가격·모델명을 확정 서술하는 습관" 차단이지 벤더명 언급 금지가 아니다.
  // 단순 언급까지 막으면 S8에 기술 스택을 쓸 수 없어 영원히 내보내기가 막힌다.
  it.each([
    'Vercel에 배포한다',
    '보유 키는 Google AI Studio에서 발급받는다',
    'Suggestion: 상태 관리는 Zustand를 쓴다',
  ])('통과: 단순 언급은 잡지 않는다 — "%s"', (line) => {
    const s = validState();
    s.sections.S8.content = line + '. ' + filler;
    expect(codes(s)).not.toContain('UNTAGGED_PROPER_NOUN');
  });

  it.each([
    ['가격 주장', 'Vercel 호비 플랜은 월 $20이다'],
    ['성능 주장', 'Gemini는 무료 티어를 지원한다'],
    ['버전이 붙은 모델명', 'GPT-4를 엔진으로 쓴다'],
  ])('차단: %s — "%s"', (_label, line) => {
    const s = validState();
    s.sections.S8.content = line + '. ' + filler;
    expect(codes(s)).toContain('UNTAGGED_PROPER_NOUN');
  });
});

describe('BUDGET_OVERRUN', () => {
  it('실패: 원가 합계가 S0 예산 상한 초과', () => {
    const s = validState();
    s.sections.S0.content = '개발 중 API 예산 상한은 $10 입니다. ' + filler;
    s.costModel = [{ item: 'LLM 호출', unit: '세션당', estimatedCost: 12, verified: true, note: '' }];
    expect(codes(s)).toContain('BUDGET_OVERRUN');
  });

  it('통과: 예산 이내', () => {
    const s = validState();
    s.sections.S0.content = '개발 중 API 예산 상한은 $10 입니다. ' + filler;
    s.costModel = [{ item: 'LLM 호출', unit: '세션당', estimatedCost: 3, verified: true, note: '' }];
    expect(codes(s)).not.toContain('BUDGET_OVERRUN');
  });

  it('통과: 예산 표기가 없으면 초과도 없다', () => {
    const s = validState();
    s.costModel = [{ item: 'LLM 호출', unit: '세션당', estimatedCost: 999, verified: true, note: '' }];
    expect(codes(s)).not.toContain('BUDGET_OVERRUN');
  });
});

// --- §6.4 경고 규칙 — 내보내기는 허용 --------------------------------------

describe('경고 규칙', () => {
  it('TOO_MANY_FR: FR 12개 초과 시 경고하되 차단하지 않는다', () => {
    const s = validState();
    s.requirements = [
      ...Array.from({ length: 13 }, (_, i) => fr(`FR-${String(i + 1).padStart(3, '0')}`)),
      nfr('NFR-001'), nfr('NFR-002'), nfr('NFR-003'), nfr('NFR-004'),
    ];
    expect(codes(s)).toContain('TOO_MANY_FR');
    expect(completeness(s).incomplete).toBe(0);
  });

  it('TOO_MANY_INFERRED: inferred 가정 5개 초과', () => {
    const s = validState();
    s.assumptions = Array.from({ length: 6 }, (_, i) => ({ text: `가정${i}`, source: 'inferred' as const }));
    expect(codes(s)).toContain('TOO_MANY_INFERRED');
    expect(completeness(s).incomplete).toBe(0);
  });

  it('SECTION_STALE: 20턴 이상 empty 유지', () => {
    const s = validState();
    s.turn = 30;
    s.sections.S9.status = 'empty';
    s.sections.S9.updatedAtTurn = 0;
    expect(codes(s)).toContain('SECTION_STALE');
    expect(completeness(s).incomplete).toBe(0);
  });
});

// --- 보조 함수 -------------------------------------------------------------

describe('countListItems', () => {
  it('불릿과 번호 목록을 센다', () => {
    expect(countListItems('- a\n* b\n+ c\n1. d')).toBe(4);
  });

  it('표는 헤더를 빼고 센다', () => {
    expect(countListItems('| h1 | h2 |\n|---|---|\n| a | b |\n| c | d |')).toBe(2);
  });

  it('빈 문자열은 0', () => {
    expect(countListItems('')).toBe(0);
  });
});

describe('parseBudgetUSD', () => {
  it('USD 표기를 읽는다', () => {
    expect(parseBudgetUSD('예산 상한 $50')).toBe(50);
  });

  it('원화 표기를 USD로 환산한다', () => {
    expect(parseBudgetUSD('예산 상한 30,000원')).toBeCloseTo(30000 / KRW_PER_USD);
  });

  it('표기가 없으면 null', () => {
    expect(parseBudgetUSD('예산은 아직 정하지 않았습니다')).toBeNull();
  });
});
