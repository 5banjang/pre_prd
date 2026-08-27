// 실제 API를 때리는 연기 테스트. 기본적으로 건너뛴다.
//
//   GOOGLE_API_KEY=... npx vitest run live.smoke
//
// 목적은 검증이 아니라 **계약이 살아있는지 확인**하는 것이다.
// 모델·스키마·필드명이 바뀌면 여기가 먼저 깨진다.

import { describe, it, expect } from 'vitest';
import { runTurn } from './callEngine.js';
import { createEmptyState } from '../types/prd.js';
import { ENGINE_MODEL, estimateCost } from '../config.js';

const KEY = process.env.GOOGLE_API_KEY;

describe.skipIf(!KEY)(`실제 호출 — ${ENGINE_MODEL.id}`, () => {
  it('한 턴 왕복이 성공하고 S0부터 취조한다', { timeout: 120_000 }, async () => {
    const r = await runTurn(createEmptyState('연기 테스트'), '할 일 관리 앱을 만들고 싶어요', {
      apiKey: KEY!,
    });

    if (!r.ok) throw new Error(`${r.error.kind}: ${r.error.message}`);

    console.log('\nreply:', r.reply.slice(0, 300));
    console.log('nextFocus 이후 섹션:', Object.values(r.state.sections)
      .filter((s) => s.status !== 'empty')
      .map((s) => `${s.id}(${s.status}, ${s.content.length}자)`).join(' '));
    console.log('openQuestions:', r.state.openQuestions.length);
    console.log('거부된 패치:', r.rejected.length);
    console.log('토큰: in=%d out=%d (thinking=%d) 비용≈$%s',
      r.usage.inputTokens, r.usage.outputTokens, r.usage.thinkingTokens,
      estimateCost(r.usage.inputTokens, r.usage.outputTokens).toFixed(6));
    console.log('차단 이슈:', r.issues.filter((i) => i.severity === 'block').length);

    // 스펙 §5.2 인터뷰 1단계: S0를 먼저 확정한다
    expect(r.state.sections.S0.status).not.toBe('empty');
    expect(r.reply.length).toBeGreaterThan(20);
    expect(r.state.turn).toBe(1);

    // 지어낸 섹션 ID가 섞여 들어오지 않았는지
    expect(r.rejected.filter((x) => x.reason === 'unknown_section')).toHaveLength(0);

    // 아직 완성일 리 없다 — 검증기가 막아야 정상
    expect(r.issues.some((i) => i.severity === 'block')).toBe(true);
  });
});
