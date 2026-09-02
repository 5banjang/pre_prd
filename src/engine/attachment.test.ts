import { describe, it, expect } from 'vitest';
import {
  MAX_ATTACHMENT_BYTES, MAX_ATTACHMENT_MB, bytesToBase64, classifyFile, estimateAudioTokens,
} from './attachment.js';
import { buildExtractPrompt, extractAttachment } from './extract.js';
import { createEmptyState, type PRDState } from '../types/prd.js';

const file = (name: string, size = 1000) => ({ name, size });

describe('첨부 검사 — §B1 AC5', () => {
  it('문서와 녹음을 종류까지 구분해 받는다', () => {
    expect(classifyFile(file('기획안.pdf'))).toMatchObject({ ok: true, kind: 'document', mimeType: 'application/pdf' });
    expect(classifyFile(file('메모.md'))).toMatchObject({ ok: true, kind: 'document' });
    expect(classifyFile(file('회의록.m4a'))).toMatchObject({ ok: true, kind: 'audio' });
    expect(classifyFile(file('통화.MP3'))).toMatchObject({ ok: true, kind: 'audio' });
  });

  it('브라우저가 MIME을 비워 보내도 확장자로 판정한다', () => {
    expect(classifyFile({ name: '노트.md', size: 10, type: '' })).toMatchObject({ ok: true });
  });

  it('지원하지 않는 형식은 무엇을 넣어야 하는지 알려준다', () => {
    const r = classifyFile(file('디자인.psd'));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain('psd');
      expect(r.message).toContain('pdf');
    }
  });

  it('한도 초과는 **숫자로** 알린다 — "지원하지 않습니다"로 끝내지 않는다', () => {
    const r = classifyFile(file('긴녹음.mp3', MAX_ATTACHMENT_BYTES + 1));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.message).toContain(`${MAX_ATTACHMENT_MB}MB`);
      expect(r.message).toContain('12.0MB');
    }
  });

  it('빈 파일은 부르기 전에 막는다', () => {
    expect(classifyFile(file('빈.pdf', 0)).ok).toBe(false);
  });

  it('오디오 토큰은 초당 32 — 길이를 모르면 추정하지 않는다', () => {
    expect(estimateAudioTokens(60)).toBe(1920);
    expect(estimateAudioTokens(null)).toBeNull();
  });

  it('큰 바이트 배열도 base64로 바꾼다 — 조각내 돌려 스택이 터지지 않는다', () => {
    const big = new Uint8Array(200_000).fill(65);
    const encoded = bytesToBase64(big);
    expect(atob(encoded)).toHaveLength(200_000);
  });
});

// --- 1회 추출 ---------------------------------------------------------------

function stubFetch(payload: unknown, usage = { promptTokenCount: 900, candidatesTokenCount: 120 }) {
  return async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }],
    usageMetadata: usage,
  }), { status: 200 });
}

const blob = (text = 'hello') => new Blob([text], { type: 'text/plain' });

const input = () => ({
  kind: 'document' as const,
  mimeType: 'application/pdf',
  name: '기획안.pdf',
  bytes: 5,
  file: blob(),
});

function seeded(): PRDState {
  const s = createEmptyState('테스트');
  s.turn = 3;
  return s;
}

describe('자료 1회 추출 — §B1', () => {
  const payload = {
    reply: '기획안에서 대상 사용자와 범위를 읽어 두 항목에 반영했습니다.',
    setSections: [{ id: 'S1', content: '## 한 줄 정의\n동네 모임 앱', status: 'drafting' }],
    addAssumptions: [{ text: '주 사용자는 30대로 가정', source: 'inferred' }],
    addUnverified: ['카카오 오픈채팅 MAU 100만'],
    addOpenQuestions: ['예산은 자료에 없었다'],
    questions: [],
    nextFocus: 'S2',
  };

  it('원본을 상태에 남기지 않고 흔적만 기록한다 — AC2', async () => {
    const r = await extractAttachment(seeded(), input(), {
      apiKey: 'k', fetchImpl: stubFetch(payload) as never, newId: () => 'att-1',
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;

    expect(r.state.attachments).toHaveLength(1);
    expect(r.state.attachments[0]).toMatchObject({
      id: 'att-1', kind: 'document', name: '기획안.pdf', bytes: 5, extractedAtTurn: 3,
      tokensUsed: 1020, touchedSections: ['S1'],
    });
    // 상태 어디에도 원본이 없다
    expect(JSON.stringify(r.state)).not.toContain('hello');
  });

  it('읽은 내용은 확정이 아니라 초안으로 들어간다 — AC1', async () => {
    const r = await extractAttachment(seeded(), input(), {
      apiKey: 'k', fetchImpl: stubFetch(payload) as never,
    });
    if (!r.ok) throw new Error('실패');
    expect(r.state.sections.S1.status).toBe('drafting');
  });

  it('자료에서 나온 판단은 inferred로 남는다 — AC3', async () => {
    const r = await extractAttachment(seeded(), input(), {
      apiKey: 'k', fetchImpl: stubFetch(payload) as never,
    });
    if (!r.ok) throw new Error('실패');
    expect(r.state.assumptions).toEqual([{ text: '주 사용자는 30대로 가정', source: 'inferred' }]);
    expect(r.state.unverifiedTerms).toContain('카카오 오픈채팅 MAU 100만');
  });

  it('쓴 토큰을 합산해 돌려준다 — AC4', async () => {
    const r = await extractAttachment(seeded(), input(), {
      apiKey: 'k', fetchImpl: stubFetch(payload) as never,
    });
    if (!r.ok) throw new Error('실패');
    expect(r.usage).toMatchObject({ inputTokens: 900, outputTokens: 120 });
    expect(r.record.tokensUsed).toBe(1020);
  });

  it('대화에는 요약만 남는다. 턴은 올라가지 않는다', async () => {
    const before = seeded();
    const r = await extractAttachment(before, input(), {
      apiKey: 'k', fetchImpl: stubFetch(payload) as never,
    });
    if (!r.ok) throw new Error('실패');
    expect(r.state.turn).toBe(before.turn);
    expect(r.state.history.map((h) => h.text)).toEqual([
      '[자료 첨부] 기획안.pdf',
      '기획안에서 대상 사용자와 범위를 읽어 두 항목에 반영했습니다.',
    ]);
  });

  it('호출이 실패해도 기존 상태는 그대로다 — AC6', async () => {
    const before = seeded();
    const r = await extractAttachment(before, input(), {
      apiKey: 'k',
      fetchImpl: (async () => new Response('nope', { status: 500 })) as never,
    });
    expect(r.ok).toBe(false);
    expect(r.state).toBe(before);
    if (!r.ok) expect(r.error.kind).toBe('server');
  });

  it('실패해도 재시도하지 않는다 — 첨부는 요청이 크고 비싸다', async () => {
    let calls = 0;
    await extractAttachment(seeded(), input(), {
      apiKey: 'k',
      fetchImpl: (async () => { calls += 1; return new Response('nope', { status: 500 }); }) as never,
    });
    expect(calls).toBe(1);
  });

  it('상태 JSON을 함께 실어 보낸다 — 어디가 비었는지 알아야 채운다', () => {
    const prompt = buildExtractPrompt(seeded(), { ...input(), note: '예산 부분만 봐줘' });
    expect(prompt).toContain('기획안.pdf');
    expect(prompt).toContain('예산 부분만 봐줘');
    expect(prompt).toContain('"turn": 3');
    // 이력은 상태 JSON에 싣지 않는다 (프롬프트 규약 §5.1)
    expect(prompt).not.toContain('"history"');
  });
});
