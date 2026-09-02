import { describe, it, expect, vi } from 'vitest';
import { applyPatches, editSection, unlockSection } from './applyPatches.js';
import { createEmptyState, type PRDState, type Requirement } from '../types/prd.js';

/** 경고를 콘솔로 흘리지 않고 모아서 본다 */
function collect() {
  const warnings: string[] = [];
  return { onWarn: (m: string) => warnings.push(m), warnings };
}

function baseState(): PRDState {
  const s = createEmptyState('테스트');
  s.turn = 7;
  return s;
}

const req = (id: string, over: Partial<Requirement> = {}): Requirement => ({
  id,
  title: `제목 ${id}`,
  description: '설명',
  acceptanceCriteria: ['조건 하나', '조건 둘'],
  priority: 'Must',
  dependsOn: [],
  section: 'FR',
  ...over,
});

// --- FR-003 AC ------------------------------------------------------------

describe('set_section', () => {
  it('content를 교체하고 updatedAtTurn을 갱신한다', () => {
    const s = baseState();
    const { state, applied } = applyPatches(s, [
      { op: 'set_section', id: 'S1', content: '새 내용', status: 'confirmed' },
    ]);
    expect(applied).toBe(1);
    expect(state.sections.S1.content).toBe('새 내용');
    expect(state.sections.S1.status).toBe('confirmed');
    expect(state.sections.S1.updatedAtTurn).toBe(7);
  });

  it('이어붙이지 않고 교체한다 — 스펙 §5.3', () => {
    let s = baseState();
    s = applyPatches(s, [{ op: 'set_section', id: 'S1', content: '처음', status: 'drafting' }]).state;
    s = applyPatches(s, [{ op: 'set_section', id: 'S1', content: '나중', status: 'confirmed' }]).state;
    expect(s.sections.S1.content).toBe('나중');
  });

  it('입력 상태를 변형하지 않는다 (순수 함수)', () => {
    const s = baseState();
    applyPatches(s, [{ op: 'set_section', id: 'S1', content: 'X', status: 'confirmed' }]);
    expect(s.sections.S1.content).toBe('');
    expect(s.sections.S1.status).toBe('empty');
  });
});

describe('알 수 없는 입력 — 앱이 죽지 않는다', () => {
  it('알 수 없는 op은 무시하고 경고를 남긴다', () => {
    const { onWarn, warnings } = collect();
    const s = baseState();
    const r = applyPatches(s, [{ op: 'delete_everything', id: 'S1' }], { onWarn });
    expect(r.applied).toBe(0);
    expect(r.rejected[0]!.reason).toBe('unknown_op');
    expect(warnings).toHaveLength(1);
  });

  it('존재하지 않는 섹션 ID는 무시하고 사유를 구분한다 — 스펙 §11', () => {
    const { onWarn, warnings } = collect();
    const r = applyPatches(baseState(), [
      { op: 'set_section', id: 'S99', content: 'x', status: 'confirmed' },
    ], { onWarn });
    expect(r.applied).toBe(0);
    expect(r.rejected[0]!.reason).toBe('unknown_section');
    expect(warnings[0]).toContain('S99');
  });

  it.each([null, undefined, 42, 'set_section', [], {}])('형식 위반(%s)을 버틴다', (bad) => {
    const { onWarn } = collect();
    expect(() => applyPatches(baseState(), [bad], { onWarn })).not.toThrow();
  });

  it('유효한 패치와 섞여 있어도 유효한 것만 적용한다', () => {
    const { onWarn } = collect();
    const r = applyPatches(baseState(), [
      { op: 'nonsense' },
      { op: 'set_section', id: 'S2', content: '정상', status: 'confirmed' },
      null,
    ], { onWarn });
    expect(r.applied).toBe(1);
    expect(r.rejected).toHaveLength(2);
    expect(r.state.sections.S2.content).toBe('정상');
  });

  it('기본 동작은 console.warn으로 흘린다', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    applyPatches(baseState(), [{ op: 'nope' }]);
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });
});

describe('add_requirement', () => {
  it('추가한다', () => {
    const r = applyPatches(baseState(), [{ op: 'add_requirement', requirement: req('FR-001') }]);
    expect(r.state.requirements).toHaveLength(1);
  });

  it('중복 ID는 기존 항목을 덮어쓴다', () => {
    let s = baseState();
    s = applyPatches(s, [{ op: 'add_requirement', requirement: req('FR-001') }]).state;
    s = applyPatches(s, [
      { op: 'add_requirement', requirement: req('FR-001', { title: '수정된 제목' }) },
    ]).state;
    expect(s.requirements).toHaveLength(1);
    expect(s.requirements[0]!.title).toBe('수정된 제목');
  });

  it('스키마를 어긴 요구사항은 거부한다', () => {
    const { onWarn } = collect();
    const r = applyPatches(baseState(), [
      { op: 'add_requirement', requirement: { id: 'FR-001', priority: '아무거나' } },
    ], { onWarn });
    expect(r.applied).toBe(0);
    expect(r.state.requirements).toHaveLength(0);
  });
});

describe('add_open_question / add_unverified', () => {
  it('추가하고 중복은 걸러낸다', () => {
    const r = applyPatches(baseState(), [
      { op: 'add_open_question', text: '같은 질문' },
      { op: 'add_open_question', text: '같은 질문' },
      { op: 'add_unverified', term: 'GPT-4' },
      { op: 'add_unverified', term: 'GPT-4' },
    ]);
    expect(r.state.openQuestions).toEqual(['같은 질문']);
    expect(r.state.unverifiedTerms).toEqual(['GPT-4']);
  });

  it('빈 문자열은 거부한다', () => {
    const { onWarn } = collect();
    const r = applyPatches(baseState(), [{ op: 'add_open_question', text: '   ' }], { onWarn });
    expect(r.applied).toBe(0);
  });
});

describe('add_cost_line', () => {
  it('추가한다', () => {
    const r = applyPatches(baseState(), [{
      op: 'add_cost_line',
      line: { item: 'LLM 호출', unit: '세션당', estimatedCost: 3.15, verified: true, note: '' },
    }]);
    expect(r.state.costModel).toHaveLength(1);
  });

  it('estimatedCost가 숫자가 아니면 거부한다', () => {
    const { onWarn } = collect();
    const r = applyPatches(baseState(), [{
      op: 'add_cost_line',
      line: { item: 'x', unit: 'y', estimatedCost: '비쌈', verified: true, note: '' },
    }], { onWarn });
    expect(r.applied).toBe(0);
  });
});

// --- §13 Q2 사용자 편집 보호 -----------------------------------------------

describe('섹션 잠금 — §13 Q2', () => {
  it('직접 편집하면 잠긴다', () => {
    const s = editSection(baseState(), 'S4', '내가 쓴 내용');
    expect(s.sections.S4.locked).toBe(true);
    expect(s.sections.S4.content).toBe('내가 쓴 내용');
  });

  it('잠긴 섹션의 set_section은 거부되고 내용이 보존된다', () => {
    const { onWarn } = collect();
    const s = editSection(baseState(), 'S4', '내가 쓴 내용');
    const r = applyPatches(s, [
      { op: 'set_section', id: 'S4', content: '엔진이 덮어쓴 내용', status: 'confirmed' },
    ], { onWarn });

    expect(r.applied).toBe(0);
    expect(r.state.sections.S4.content).toBe('내가 쓴 내용');
    expect(r.rejected[0]!.reason).toBe('section_locked');
    expect(r.rejected[0]!.sectionId).toBe('S4');
  });

  it('잠긴 섹션이 있어도 다른 섹션은 정상 적용된다', () => {
    const { onWarn } = collect();
    const s = editSection(baseState(), 'S4', '보호 대상');
    const r = applyPatches(s, [
      { op: 'set_section', id: 'S4', content: '덮어쓰기 시도', status: 'confirmed' },
      { op: 'set_section', id: 'S5', content: '정상 반영', status: 'confirmed' },
    ], { onWarn });

    expect(r.applied).toBe(1);
    expect(r.state.sections.S4.content).toBe('보호 대상');
    expect(r.state.sections.S5.content).toBe('정상 반영');
  });

  it('해제하면 이후 패치가 적용된다', () => {
    let s = editSection(baseState(), 'S4', '내가 쓴 내용');
    s = unlockSection(s, 'S4');
    const r = applyPatches(s, [
      { op: 'set_section', id: 'S4', content: '엔진 갱신', status: 'confirmed' },
    ]);
    expect(r.applied).toBe(1);
    expect(r.state.sections.S4.content).toBe('엔진 갱신');
  });
});

// 화면에 뜨는 문구에 내부 값이 새면 안 된다 — 사용자는 `S99`나 `set_sektion`이 뭔지 모른다.
describe('사용자 문구와 진단 분리', () => {
  const base = createEmptyState('테스트');

  it('섹션 ID 오류: 화면 문구엔 ID가 없고 콘솔엔 남는다', () => {
    const warnings: string[] = [];
    const r = applyPatches(
      base,
      [{ op: 'set_section', id: 'S99', content: 'x', status: 'drafting' }],
      { onWarn: (m) => warnings.push(m) },
    );
    expect(r.rejected[0]!.message).not.toContain('S99');
    expect(r.rejected[0]!.detail).toContain('S99');
    expect(warnings[0]).toContain('S99');
  });

  it('알 수 없는 op: 화면 문구엔 op 이름이 없다', () => {
    const r = applyPatches(base, [{ op: 'set_sektion', id: 'S1' }], { onWarn: () => {} });
    expect(r.rejected[0]!.message).not.toContain('set_sektion');
    expect(r.rejected[0]!.detail).toContain('set_sektion');
  });

  it('잠긴 섹션: 영문 명칭 대신 한글 이름으로 알린다', () => {
    const locked = editSection(base, 'S7', '손으로 쓴 내용');
    const r = applyPatches(
      locked,
      [{ op: 'set_section', id: 'S7', content: '엔진이 덮어쓰려 함', status: 'drafting' }],
      { onWarn: () => {} },
    );
    expect(r.rejected[0]!.message).toContain('예외와 실패 상황');
    expect(r.rejected[0]!.message).not.toContain('Edge Cases');
    expect(r.rejected[0]!.sectionId).toBe('S7');
  });
});

describe('가정 기록 — §B5-2 "모르겠어요"', () => {
  const base = baseState();

  it('엔진이 대신 정한 값을 가정으로 남긴다', () => {
    const r = applyPatches(base, [
      { op: 'add_assumption', assumption: { text: '배포는 정적 호스팅으로 가정', source: 'default' } },
    ], collect());
    expect(r.applied).toBe(1);
    expect(r.state.assumptions).toEqual([{ text: '배포는 정적 호스팅으로 가정', source: 'default' }]);
  });

  it('같은 문장은 두 번 쌓이지 않는다', () => {
    const r = applyPatches(base, [
      { op: 'add_assumption', assumption: { text: '월 예산 5만원으로 가정', source: 'default' } },
      { op: 'add_assumption', assumption: { text: ' 월 예산 5만원으로 가정 ', source: 'inferred' } },
    ], collect());
    expect(r.state.assumptions).toHaveLength(1);
  });

  it('출처가 규약 밖이거나 본문이 비면 버린다 — LLM 출력은 신뢰하지 않는다', () => {
    const c = collect();
    const r = applyPatches(base, [
      { op: 'add_assumption', assumption: { text: '뭔가', source: 'guess' } },
      { op: 'add_assumption', assumption: { text: '   ', source: 'default' } },
    ], c);
    expect(r.applied).toBe(0);
    expect(r.state.assumptions).toEqual([]);
    expect(r.rejected).toHaveLength(2);
  });

  it('입력 상태를 변형하지 않는다', () => {
    const before = baseState();
    applyPatches(before, [
      { op: 'add_assumption', assumption: { text: '가정 하나', source: 'default' } },
    ], collect());
    expect(before.assumptions).toEqual([]);
  });
});

describe('[미검증] 남발 억제 — 빌더 지적 2026-09-03', () => {
  const base = baseState();

  it('가격·버전이 붙은 것만 목록에 넣는다', () => {
    const r = applyPatches(base, [
      { op: 'add_unverified', term: 'Gemini 3.7 Flash 입력 $0.75/1M' },
      { op: 'add_unverified', term: 'Vercel 무료 티어' },
    ], collect());
    expect(r.state.unverifiedTerms).toHaveLength(2);
  });

  it('확인할 주장이 없는 이름은 걸러낸다', () => {
    const c = collect();
    const r = applyPatches(base, [
      { op: 'add_unverified', term: 'IndexedDB' },
      { op: 'add_unverified', term: 'GitHub Pages' },
      { op: 'add_unverified', term: 'Zod' },
    ], c);
    expect(r.state.unverifiedTerms).toEqual([]);
    // 사용자가 고칠 일이 아니므로 거부 목록에 올리지 않고 콘솔에만 남긴다
    expect(r.rejected).toEqual([]);
    expect(c.warnings.join(' ')).toContain('IndexedDB');
  });
});
