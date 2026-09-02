// 최소 마크다운 → HTML — 개정안 #02 §B4 "사람이 읽는 문서 · 인쇄 가능".
//
// M4에서 화면 미리보기는 `<pre>`로 미뤘다(FR-006 AC가 색 구분·즉시 갱신만 요구했으므로).
// 그러나 **인쇄 가능한 산출물**은 다르다. `<pre>` 한 덩어리는 목차도 표도 안 생긴다.
//
// 그렇다고 `react-markdown`을 들이지는 않는다. 여기서 다루는 마크다운은 우리 엔진이
// 쓴 것이고 문법 범위가 좁다 — 제목·목록·표·인용·강조·인라인 코드가 전부다.
// 지원하지 않는 문법은 **그대로 통과시킨다.** 깨뜨리느니 원문으로 보이는 편이 낫다.

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 인라인 조판. 이스케이프를 **먼저** 하므로 원문의 태그는 절대 살아나지 않는다. */
function inline(s: string): string {
  return escapeHtml(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    // [미검증]·미정은 눈에 띄어야 한다. 이 앱의 산출물에서 가장 중요한 두 단어다.
    .replace(/\[미검증\]/g, '<span class="tag-unverified">[미검증]</span>')
    .replace(/(^|[\s(])미정(?=[\s).,]|$)/g, '$1<span class="tag-todo">미정</span>');
}

const isTableRow = (l: string) => /^\|.*\|\s*$/.test(l);
const isDivider = (l: string) => /^\|[\s:|-]+\|\s*$/.test(l);

function cells(line: string): string[] {
  return line.replace(/^\||\|\s*$/g, '').split('|').map((c) => c.trim());
}

/**
 * 지원 문법: `#`~`######` · `-`/`*`/`1.` 목록 · `|` 표 · `>` 인용 · `---` 구분선 ·
 * ``` 코드 블록 · 나머지는 문단.
 */
export function mdToHtml(md: string): string {
  const lines = md.replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  let i = 0;

  // 문단 버퍼. 빈 줄이나 블록 시작에서 비운다.
  let para: string[] = [];
  function flushPara() {
    if (para.length > 0) {
      out.push(`<p>${para.map(inline).join('<br>')}</p>`);
      para = [];
    }
  }

  while (i < lines.length) {
    const line = lines[i]!;
    const t = line.trim();

    if (t === '') { flushPara(); i += 1; continue; }

    // 코드 블록 — 안쪽은 조판하지 않는다
    const fence = /^(`{3,}|~{3,})(.*)$/.exec(t);
    if (fence) {
      flushPara();
      const marker = fence[1]!;
      const body: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i]!.trim().startsWith(marker.slice(0, 3))) {
        body.push(lines[i]!);
        i += 1;
      }
      i += 1; // 닫는 울타리
      out.push(`<pre><code>${escapeHtml(body.join('\n'))}</code></pre>`);
      continue;
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(t);
    if (heading) {
      flushPara();
      const level = heading[1]!.length;
      out.push(`<h${level}>${inline(heading[2]!)}</h${level}>`);
      i += 1;
      continue;
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) {
      flushPara();
      out.push('<hr>');
      i += 1;
      continue;
    }

    // 표 — 헤더 + 구분선이 있어야 표로 인정한다
    if (isTableRow(t) && i + 1 < lines.length && isDivider(lines[i + 1]!.trim())) {
      flushPara();
      const head = cells(t);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && isTableRow(lines[i]!.trim())) {
        rows.push(cells(lines[i]!.trim()));
        i += 1;
      }
      out.push(
        '<table><thead><tr>',
        ...head.map((c) => `<th>${inline(c)}</th>`),
        '</tr></thead><tbody>',
        ...rows.map((r) => `<tr>${r.map((c) => `<td>${inline(c)}</td>`).join('')}</tr>`),
        '</tbody></table>',
      );
      continue;
    }

    if (t.startsWith('>')) {
      flushPara();
      const body: string[] = [];
      while (i < lines.length && lines[i]!.trim().startsWith('>')) {
        body.push(lines[i]!.trim().replace(/^>\s?/, ''));
        i += 1;
      }
      out.push(`<blockquote>${mdToHtml(body.join('\n'))}</blockquote>`);
      continue;
    }

    // 목록 — 체크박스(`- [ ]`)는 AC 표시라 그대로 살린다
    const bullet = /^([-*+]|\d+\.)\s+/.exec(t);
    if (bullet) {
      flushPara();
      const ordered = /^\d+\./.test(bullet[1]!);
      const items: string[] = [];
      while (i < lines.length) {
        const cur = lines[i]!.trim();
        const m = /^([-*+]|\d+\.)\s+(.*)$/.exec(cur);
        if (!m) break;
        if (/^\d+\./.test(m[1]!) !== ordered) break;
        const box = /^\[([ xX])\]\s*(.*)$/.exec(m[2]!);
        items.push(box
          ? `<li class="task">${box[1]!.trim() === '' ? '☐' : '☑'} ${inline(box[2]!)}</li>`
          : `<li>${inline(m[2]!)}</li>`);
        i += 1;
      }
      const tag = ordered ? 'ol' : 'ul';
      out.push(`<${tag}>${items.join('')}</${tag}>`);
      continue;
    }

    para.push(t);
    i += 1;
  }

  flushPara();
  return out.join('\n');
}
