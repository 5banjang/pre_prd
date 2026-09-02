import { describe, it, expect } from 'vitest';
import {
  COMPACT_LIMIT,
  forbiddenList,
  orderByDependency,
  permissionCandidates,
  renderCompact,
  renderDraft,
  renderDraftBanner,
  renderFullPRD,
  renderSetupGuide,
} from './render.js';
import { createEmptyState, type PRDState, type Requirement } from '../types/prd.js';
import type { ValidationIssue } from '../validator/validate.js';

const fr = (id: string, over: Partial<Requirement> = {}): Requirement => ({
  id,
  title: `기능 ${id}`,
  description: '설명',
  acceptanceCriteria: ['전송하면 3초 이내에 표시된다', '실패한 경우 오류가 노출된다'],
  priority: 'Must',
  dependsOn: [],
  section: 'FR',
  ...over,
});

function filled(): PRDState {
  const s = createEmptyState('러닝 크루 앱');
  for (const id of Object.keys(s.sections) as (keyof typeof s.sections)[]) {
    s.sections[id].status = 'confirmed';
    s.sections[id].content = `${id} 본문입니다.`;
  }
  s.sections.S3.content = '- 회원가입·인증\n- 결제\n- 서버 DB';
  s.sections.S8.content = 'Suggestion: React + Vite + TypeScript. 테스트는 Vitest.';
  s.requirements = [
    fr('FR-001'),
    fr('FR-002', { dependsOn: ['FR-001'] }),
    fr('FR-003', { priority: 'Should' }),
    fr('NFR-001', { section: 'NFR', title: '보안' }),
  ];
  s.openQuestions = ['배포처 확정', '가격 확인'];
  s.unverifiedTerms = ['Gemini 3.7 Flash 단가'];
  s.costModel = [{ item: 'LLM 호출', unit: '세션당', estimatedCost: 0.25, verified: false, note: '실측' }];
  s.turn = 12;
  return s;
}

describe('forbiddenList — S3를 구현 금지 목록으로', () => {
  it('불릿 목록을 뽑는다', () => {
    expect(forbiddenList(filled())).toEqual(['회원가입·인증', '결제', '서버 DB']);
  });

  it('표 형식도 첫 열을 뽑는다', () => {
    const s = filled();
    s.sections.S3.content = '| 항목 | 사유 |\n|---|---|\n| 음성 입력 | 부가 기능 |\n| 다국어 | v2 |';
    expect(forbiddenList(s)).toEqual(['음성 입력', '다국어']);
  });

  it('비어 있으면 빈 배열', () => {
    const s = createEmptyState();
    expect(forbiddenList(s)).toEqual([]);
  });
});

describe('renderFullPRD — FR-008', () => {
  it('LLM 없이 상태에서 결정적으로 조립한다 (AC1)', () => {
    const s = filled();
    expect(renderFullPRD(s)).toBe(renderFullPRD(s));
  });

  it('요구사항을 AC와 함께 렌더링한다', () => {
    const md = renderFullPRD(filled());
    expect(md).toContain('### FR-001: 기능 FR-001');
    expect(md).toContain('- [ ] 전송하면 3초 이내에 표시된다');
    expect(md).toContain('- **의존성:** FR-001');
  });

  it('Handoff Note가 말미에 자동 삽입된다 (AC3)', () => {
    const md = renderFullPRD(filled());
    expect(md).toContain('## Handoff Note (개발 AI에게)');
    expect(md.trimEnd().endsWith('결정적으로 조립했다.*')).toBe(true);
  });

  it('Handoff Note에 구현 금지 목록이 들어간다', () => {
    const md = renderFullPRD(filled());
    const note = md.slice(md.indexOf('## Handoff Note'));
    expect(note).toContain('- 회원가입·인증');
    expect(note).toContain('- 결제');
  });

  it('원가 표와 합계를 렌더링한다', () => {
    const md = renderFullPRD(filled());
    expect(md).toContain('| LLM 호출 | 세션당 | $0.25 | [미검증] | 실측 |');
    expect(md).toContain('**합계: $0.25**');
  });

  it('빈 섹션은 건너뛴다', () => {
    const s = createEmptyState('빈 문서');
    expect(renderFullPRD(s)).not.toContain('## S4.');
  });
});

describe('renderCompact — FR-009', () => {
  it('S3가 "구현 금지" 목록으로 명시된다 (AC1)', () => {
    const c = renderCompact(filled());
    expect(c).toContain('## 구현 금지 (Out of Scope)');
    expect(c).toContain('- 회원가입·인증');
  });

  it('4,000자 이내면 전체 FR을 담는다', () => {
    const c = renderCompact(filled());
    expect(c.length).toBeLessThanOrEqual(COMPACT_LIMIT);
    expect(c).toContain('FR-003');
    expect(c).not.toContain('Must만');
  });

  it('4,000자를 초과하면 Must만 남긴다 (AC2)', () => {
    const s = filled();
    s.requirements = [
      ...Array.from({ length: 30 }, (_, i) =>
        fr(`FR-${String(i + 1).padStart(3, '0')}`, { description: '설명 '.repeat(40) })),
      fr('FR-900', { priority: 'Could', title: '미룰 것', description: '설명 '.repeat(40) }),
    ];
    const c = renderCompact(s);
    expect(c).toContain('Must만');
    expect(c).not.toContain('FR-900');
  });

  it('전체본보다 짧다', () => {
    const s = filled();
    expect(renderCompact(s).length).toBeLessThan(renderFullPRD(s).length);
  });
});

describe('orderByDependency — FR-013 AC2', () => {
  it('의존성을 위반하지 않는 순서로 정렬한다', () => {
    const reqs = [
      fr('FR-003', { dependsOn: ['FR-002'] }),
      fr('FR-002', { dependsOn: ['FR-001'] }),
      fr('FR-001'),
    ];
    expect(orderByDependency(reqs).map((r) => r.id)).toEqual(['FR-001', 'FR-002', 'FR-003']);
  });

  it('목록 밖의 의존성은 무시한다', () => {
    const reqs = [fr('FR-001', { dependsOn: ['FR-999'] })];
    expect(orderByDependency(reqs).map((r) => r.id)).toEqual(['FR-001']);
  });

  it('순환이 있어도 멈추지 않고 전부 돌려준다', () => {
    const reqs = [
      fr('FR-001', { dependsOn: ['FR-002'] }),
      fr('FR-002', { dependsOn: ['FR-001'] }),
    ];
    expect(orderByDependency(reqs)).toHaveLength(2);
  });
});

describe('permissionCandidates', () => {
  it('S8에서 스택을 읽어 후보를 만든다', () => {
    const p = permissionCandidates('Suggestion: React + Vite + TypeScript, 테스트는 Vitest');
    expect(p).toContain('Bash(npm run:*)');
    expect(p).toContain('Bash(npx vitest:*)');
  });

  it('파이썬 스택을 알아본다', () => {
    const p = permissionCandidates('FastAPI + pytest');
    expect(p).toContain('Bash(pytest:*)');
    expect(p).not.toContain('Bash(npx vitest:*)');
  });

  it('스택을 몰라도 기본값은 준다', () => {
    expect(permissionCandidates('')).toContain('Read');
  });
});

describe('renderSetupGuide — FR-013', () => {
  it('CLAUDE.md 초안에 구현 금지 목록이 들어간다 (AC1)', () => {
    const g = renderSetupGuide(filled());
    expect(g).toContain('## 1. `CLAUDE.md` 초안');
    expect(g).toContain('## 구현 금지 (Out of Scope)');
    expect(g).toContain('- 회원가입·인증');
  });

  it('개발 순서가 의존성 순이다 (AC2)', () => {
    const g = renderSetupGuide(filled());
    expect(g.indexOf('FR-001')).toBeLessThan(g.indexOf('FR-002'));
  });

  it('권한 allowlist가 유효한 JSON이다', () => {
    const g = renderSetupGuide(filled());
    const json = g.slice(g.indexOf('```json') + 7, g.lastIndexOf('```'));
    expect(() => JSON.parse(json.trim())).not.toThrow();
  });

  it('미해결 질문과 [미검증] 항목을 체크리스트로 낸다', () => {
    const g = renderSetupGuide(filled());
    expect(g).toContain('- [ ] 배포처 확정');
    expect(g).toContain('- [ ] Gemini 3.7 Flash 단가');
  });

  it('결정적이다 (AC3)', () => {
    const s = filled();
    expect(renderSetupGuide(s)).toBe(renderSetupGuide(s));
  });
});


// --- 개정안 #02 §A — 미정 목록은 항상 붙는다 -------------------------------

describe('renderDraftBanner — 미정 고지', () => {
  const pending: ValidationIssue[] = [
    { severity: 'incomplete', code: 'FEW_EDGE_CASES', message: '엣지 케이스가 2개뿐입니다', sectionId: 'S7' },
    { severity: 'incomplete', code: 'NO_NFR', message: 'NFR이 하나도 없습니다' },
    { severity: 'warn', code: 'TOO_MANY_FR', message: 'FR이 12개를 넘습니다' },
  ];

  it('미완성이 없어도 침묵하지 않는다 — 통과 사실을 남긴다', () => {
    const out = renderDraftBanner([]);
    expect(out).not.toBe('');
    expect(out).toContain('검증 통과');
  });

  it('미완성 건수와 각 항목을 나열한다', () => {
    const out = renderDraftBanner(pending);
    expect(out).toContain('미정 2건');
    expect(out).toContain('엣지 케이스가 2개뿐입니다');
    expect(out).toContain('NFR이 하나도 없습니다');
    expect(out).toContain('S7');
  });

  it('경고는 미정으로 세지 않는다', () => {
    expect(renderDraftBanner(pending)).not.toContain('FR이 12개를 넘습니다');
  });

  it('개발 AI에게 임의로 채우지 말라고 명시한다', () => {
    const out = renderDraftBanner(pending);
    expect(out).toContain('임의로 채워서 구현하지 말 것');
  });

  it('sectionId가 없는 전역 이슈도 누락하지 않는다', () => {
    expect(renderDraftBanner(pending)).toContain('문서 전체');
  });
});

describe('renderDraft — 정식 내보내기 경로', () => {
  it('미완성 여부와 무관하게 본문이 항상 나온다', () => {
    const s = createEmptyState('테스트 프로젝트');
    const many: ValidationIssue[] = [
      { severity: 'incomplete', code: 'NO_FR', message: 'FR이 없습니다' },
    ];
    const out = renderDraft(s, many);
    expect(out).toContain('테스트 프로젝트');
    expect(out).toContain('Handoff Note');
  });

  it('배너가 본문보다 먼저 온다', () => {
    const s = createEmptyState('X');
    const out = renderDraft(s, []);
    expect(out.indexOf('검증 통과')).toBeLessThan(out.indexOf('Handoff Note'));
  });
});

describe('읽어들인 자료 — FR-015', () => {
  it('어느 항목이 자료에서 왔는지 문서에 남긴다', () => {
    const s = createEmptyState('산책 메이트');
    s.attachments = [{
      id: 'a1', kind: 'document', name: '기획메모.md', bytes: 761,
      extractedAtTurn: 0, tokensUsed: 1200,
      summary: '배경과 범위를 읽어 반영했습니다.',
      touchedSections: ['S1', 'S2'],
    }];
    const md = renderDraft(s, []);
    expect(md).toContain('읽어들인 자료');
    expect(md).toContain('기획메모.md');
    expect(md).toContain('S1, S2');
    expect(md).toContain('배경과 범위를 읽어 반영했습니다.');
  });

  it('자료가 없으면 그 절은 나오지 않는다', () => {
    const s = createEmptyState('빈 문서');
    expect(renderDraft(s, [])).not.toContain('읽어들인 자료');
  });
});
