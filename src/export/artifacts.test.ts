import { describe, it, expect } from 'vitest';
import {
  ARTIFACTS, DEFAULT_SELECTION, byId, fileNameFor, makeBundle, renderOne,
} from './artifacts.js';
import { renderOverviewHtml, renderPrdHtml, dependencySvg } from './html.js';
import { parseStateFile } from '../storage/persist.js';
import { validate } from '../validator/validate.js';
import { createEmptyState, type PRDState, type Requirement } from '../types/prd.js';

function fr(id: string, deps: string[] = [], section: 'FR' | 'NFR' = 'FR'): Requirement {
  return {
    id, title: `${id} 제목`, description: '설명',
    acceptanceCriteria: ['조건이 참이면 값을 반환한다', '실패 시 오류를 표시한다'],
    priority: 'Must', dependsOn: deps, section,
  };
}

function filled(): PRDState {
  const s = createEmptyState('테스트 제품');
  for (const id of ['S0', 'S1', 'S2', 'S3', 'S4', 'S5', 'S6', 'S7', 'S8', 'S10', 'S11'] as const) {
    s.sections[id] = {
      ...s.sections[id], status: 'confirmed',
      content: `## ${id} 내용\n\n- 항목 하나\n- 항목 둘`,
    };
  }
  s.sections.S3.content = '- 인증\n- 결제';
  s.requirements = [fr('FR-001'), fr('FR-002', ['FR-001']), fr('FR-003', ['FR-002']), fr('NFR-001', [], 'NFR')];
  s.openQuestions = ['질문1', '질문2', '질문3', '질문4', '질문5'];
  s.assumptions = [{ text: '가정1', source: 'user' }];
  s.unverifiedTerms = ['Gemini 3.7 Flash $0.75/1M'];
  s.costModel = [{ item: 'LLM 호출', unit: '세션당', estimatedCost: 0.25, verified: false, note: '실측' }];
  s.turn = 30;
  return s;
}

describe('카탈로그', () => {
  it('id가 중복되지 않고 파일명도 겹치지 않는다', () => {
    expect(new Set(ARTIFACTS.map((a) => a.id)).size).toBe(ARTIFACTS.length);
    expect(new Set(ARTIFACTS.map((a) => a.file)).size).toBe(ARTIFACTS.length);
  });

  it('기본 선택은 사람용 2종 + 상태 JSON이다 — §B4', () => {
    expect([...DEFAULT_SELECTION].sort()).toEqual(['overview', 'prd-html', 'prd-json']);
  });

  it('모르는 id는 조용히 넘어가지 않는다', () => {
    // @ts-expect-error 런타임 방어를 확인한다
    expect(() => byId('없음')).toThrow();
  });

  it('개별 파일명에는 프로젝트명이 붙는다', () => {
    expect(fileNameFor(filled(), byId('prd-html'))).toBe('테스트-제품-PRD.html');
  });
});

describe('§B4 AC4 — 모든 산출물에 미정과 [미검증]이 들어간다', () => {
  const empty = createEmptyState('빈 문서');
  const issues = validate(empty);

  it.each(ARTIFACTS.filter((a) => a.id !== 'prd-json').map((a) => [a.id, a] as const))(
    '%s 에 미정 항목이 남는다',
    (_id, def) => {
      const text = def.render(empty, issues);
      expect(issues.filter((i) => i.severity === 'incomplete').length).toBeGreaterThan(0);
      expect(text).toMatch(/미정|MISSING_SECTION/);
    },
  );

  it('[미검증] 용어가 산출물에 실린다', () => {
    const s = filled();
    for (const def of ARTIFACTS.filter((a) => a.id !== 'prd-json')) {
      expect(def.render(s, validate(s))).toContain('Gemini 3.7 Flash $0.75/1M');
    }
  });

  it('통과한 문서에서도 검증을 거쳤다는 사실은 남는다', () => {
    const s = filled();
    const text = byId('tasks').render(s, []);
    expect(text).toContain('미정');
  });
});

describe('§B4 AC2 — prd.json 왕복', () => {
  it('내보낸 JSON을 다시 읽으면 상태가 복원된다', () => {
    const s = filled();
    const { text } = renderOne(s, validate(s), 'prd-json');
    const r = parseStateFile(text);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.projectName).toBe('테스트 제품');
    expect(r.state.requirements).toHaveLength(4);
    expect(r.state.turn).toBe(30);
    expect(r.state.sections.S2.content).toBe(s.sections.S2.content);
  });
});

describe('§B4 AC3 — HTML은 외부에 아무것도 요청하지 않는다', () => {
  const s = filled();
  const pages = [renderPrdHtml(s, validate(s)), renderOverviewHtml(s, validate(s))];

  it.each(pages.map((p, i) => [i === 0 ? 'PRD.html' : 'overview.html', p]))(
    '%s 에 외부 URL·스크립트가 없다',
    (_name, html) => {
      expect(html).not.toMatch(/<script/i);
      expect(html).not.toMatch(/https?:\/\//);
      expect(html).not.toMatch(/<link\b/i);
      expect(html).not.toMatch(/@import/i);
      expect(html).not.toMatch(/url\(\s*['"]?(?:https?:)?\/\//i);
    },
  );

  it('인쇄 스타일과 문자셋 선언을 갖춘다', () => {
    for (const html of pages) {
      expect(html).toContain('<meta charset="utf-8">');
      expect(html).toContain('@media print');
      expect(html.startsWith('<!doctype html>')).toBe(true);
    }
  });

  it('본문에 섞인 HTML은 이스케이프된다', () => {
    const evil = filled();
    evil.projectName = '<img src=x onerror=alert(1)>';
    evil.sections.S2.content = '<script>alert(2)</script>';
    const html = renderPrdHtml(evil, validate(evil));
    expect(html).not.toContain('<script>alert(2)</script>');
    expect(html).not.toContain('<img src=x');
  });
});

describe('의존성 SVG', () => {
  it('의존 깊이만큼 층이 생긴다', () => {
    const svg = dependencySvg([fr('FR-001'), fr('FR-002', ['FR-001']), fr('FR-003', ['FR-002'])]);
    expect(svg).toContain('층 3개');
    expect(svg).toContain('FR-003');
    expect(svg).toContain('<svg');
  });

  it('순환 의존이 있어도 그림을 포기하지 않는다', () => {
    const svg = dependencySvg([fr('FR-001', ['FR-002']), fr('FR-002', ['FR-001'])]);
    expect(svg).toContain('<svg');
    expect(svg).toContain('FR-001');
  });

  it('FR이 없으면 그림 대신 안내가 나온다', () => {
    expect(dependencySvg([])).not.toContain('<svg');
  });

  it('목록에 없는 의존성은 선을 그리지 않는다', () => {
    const svg = dependencySvg([fr('FR-001', ['FR-999'])]);
    expect(svg).toContain('층 1개');
  });
});

describe('§B4 AC1 — 선택 묶음 zip', () => {
  const s = filled();
  const issues = validate(s);

  it('고른 것만 담는다', () => {
    const zip = makeBundle(s, issues, ['prd-html', 'prd-json']);
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('PRD.html');
    expect(text).toContain('prd.json');
    expect(text).not.toContain('TASKS.md');
  });

  it('전체를 담으면 8종이 모두 들어간다', () => {
    const zip = makeBundle(s, issues, ARTIFACTS.map((a) => a.id));
    const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
    expect(view.getUint16(zip.length - 22 + 8, true)).toBe(ARTIFACTS.length);
  });

  it('압축 파일 안에서는 프로젝트명 없는 표준 파일명을 쓴다', () => {
    const text = new TextDecoder().decode(makeBundle(s, issues, ['prd-html']));
    expect(text).toContain('PRD.html');
    expect(text).not.toContain('테스트-제품-PRD.html');
  });
});
