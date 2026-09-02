import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { RULE_EXPLAIN, explain } from './explain.js';
import { validate } from './validate.js';
import { SECTION_DEFS, SECTION_IDS, createEmptyState } from '../types/prd.js';

/** `validate.ts` 원문에서 실제로 쓰는 코드를 긁어온다. 사전이 뒤처지면 여기서 깨진다. */
function codesInValidator(): string[] {
  const src = readFileSync(new URL('./validate.ts', import.meta.url), 'utf-8');
  return [...new Set([...src.matchAll(/code: '([A-Z_]+)'/g)].map((m) => m[1]!))];
}

describe('규칙 설명 사전', () => {
  it('검증기가 내는 모든 코드를 덮는다', () => {
    const missing = codesInValidator().filter((c) => !(c in RULE_EXPLAIN));
    expect(missing, `설명이 없는 규칙: ${missing.join(', ')}`).toEqual([]);
  });

  it('쓰지 않는 코드가 사전에 남아 있지 않다', () => {
    const used = new Set(codesInValidator());
    const stale = Object.keys(RULE_EXPLAIN).filter((c) => !used.has(c));
    expect(stale, `검증기에 없는 규칙: ${stale.join(', ')}`).toEqual([]);
  });

  it('모르는 코드에도 빈 화면을 내지 않는다', () => {
    const e = explain('아직_없는_규칙');
    expect(e.what.length).toBeGreaterThan(0);
    expect(e.why.length).toBeGreaterThan(0);
  });

  it('모든 설명에 "왜"가 있다 — 그게 없으면 사용자는 전부 건너뛴다', () => {
    for (const [code, e] of Object.entries(RULE_EXPLAIN)) {
      expect(e.why.length, code).toBeGreaterThan(10);
      expect(e.what.length, code).toBeGreaterThan(10);
    }
  });
});

describe('섹션 표시 이름', () => {
  it('12개 전부 한글 이름과 안내 문구를 갖는다', () => {
    for (const id of SECTION_IDS) {
      const d = SECTION_DEFS[id];
      expect(d.label, id).not.toBe('');
      expect(d.hint.length, id).toBeGreaterThan(10);
      // 한글 이름이어야 한다 — 영문 정식 명칭은 title에 따로 있다
      expect(d.label, id).toMatch(/[가-힣]/);
    }
  });

  it('이름이 서로 겹치지 않는다', () => {
    const labels = SECTION_IDS.map((id) => SECTION_DEFS[id].label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('검증기 메시지', () => {
  const issues = validate(createEmptyState('테스트'));

  it('내부 상태값을 화면 문구에 그대로 내보내지 않는다', () => {
    for (const i of issues) {
      expect(i.message, i.code).not.toMatch(/drafting|confirmed|empty/);
    }
  });

  it('영문 섹션 명칭을 쓰지 않는다', () => {
    for (const i of issues) {
      expect(i.message, i.code).not.toMatch(/Edge Cases|Builder Context|Out of Scope/);
    }
  });

  // "기능 요구사항이 부족합니다"처럼 이름이 문장에 자연스럽게 녹는 건 중복이 아니다.
  // 막아야 할 것은 `예외와 실패 상황: 아직 …` 같은 **접두 반복**이다 — 칩이 이미 붙인다.
  it('섹션 이름을 접두로 반복하지 않는다', () => {
    for (const i of issues) {
      if (!i.sectionId) continue;
      const label = SECTION_DEFS[i.sectionId].label;
      expect(i.message.startsWith(`${label}:`), `${i.code} 가 섹션 이름을 접두로 반복한다`)
        .toBe(false);
    }
  });
});
