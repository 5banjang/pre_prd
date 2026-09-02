import { describe, it, expect } from 'vitest';
import { escapeHtml, mdToHtml } from './markdown.js';

describe('escapeHtml', () => {
  it('태그와 따옴표를 무력화한다', () => {
    expect(escapeHtml('<script>alert("x")</script>'))
      .toBe('&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;');
  });
});

describe('mdToHtml', () => {
  it('제목을 단계별로 변환한다', () => {
    expect(mdToHtml('# 하나\n\n### 셋')).toContain('<h1>하나</h1>');
    expect(mdToHtml('# 하나\n\n### 셋')).toContain('<h3>셋</h3>');
  });

  it('불릿과 번호 목록을 구분한다', () => {
    expect(mdToHtml('- a\n- b')).toBe('<ul><li>a</li><li>b</li></ul>');
    expect(mdToHtml('1. a\n2. b')).toBe('<ol><li>a</li><li>b</li></ol>');
  });

  it('AC 체크박스를 살린다', () => {
    const h = mdToHtml('- [ ] 안 됨\n- [x] 됨');
    expect(h).toContain('☐ 안 됨');
    expect(h).toContain('☑ 됨');
  });

  it('표를 헤더와 본문으로 나눈다', () => {
    const h = mdToHtml('| 항목 | 값 |\n|---|---|\n| A | 1 |\n| B | 2 |');
    expect(h).toContain('<th>항목</th>');
    expect(h).toContain('<td>A</td>');
    expect(h.match(/<tr>/g)?.length).toBe(3);
  });

  it('구분선 없는 파이프 줄은 표로 오인하지 않는다', () => {
    expect(mdToHtml('| 그냥 문장 |')).toContain('<p>');
  });

  it('강조와 인라인 코드를 조판한다', () => {
    const h = mdToHtml('**굵게** 와 `코드`');
    expect(h).toContain('<strong>굵게</strong>');
    expect(h).toContain('<code>코드</code>');
  });

  it('코드 블록 안은 조판하지 않는다', () => {
    const h = mdToHtml('```\n# 제목 아님\n**굵지 않음**\n```');
    expect(h).toContain('<pre><code># 제목 아님\n**굵지 않음**</code></pre>');
    expect(h).not.toContain('<h1>');
  });

  it('본문 속 HTML은 절대 실행 가능한 형태로 나가지 않는다', () => {
    // 섹션 본문은 LLM과 사용자가 쓴다. 둘 다 신뢰하지 않는다.
    const h = mdToHtml('- <img src=x onerror=alert(1)>');
    expect(h).not.toContain('<img');
    expect(h).toContain('&lt;img');
  });

  it('[미검증]과 미정에 표식을 붙인다 — 산출물에서 가장 중요한 두 단어다', () => {
    expect(mdToHtml('가격은 [미검증] 이다')).toContain('tag-unverified');
    expect(mdToHtml('예산은 미정 이다')).toContain('tag-todo');
  });

  it('인용을 중첩 변환한다', () => {
    expect(mdToHtml('> **경고** 미완성')).toContain('<blockquote>');
    expect(mdToHtml('> **경고** 미완성')).toContain('<strong>경고</strong>');
  });

  it('빈 입력은 빈 문자열이다', () => {
    expect(mdToHtml('')).toBe('');
    expect(mdToHtml('\n\n')).toBe('');
  });

  it('문단 안 줄바꿈은 보존한다', () => {
    expect(mdToHtml('첫 줄\n둘째 줄')).toBe('<p>첫 줄<br>둘째 줄</p>');
  });
});
