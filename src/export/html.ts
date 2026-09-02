// 자립형 HTML 산출물 — 개정안 #02 §B4.
//
//   PRD.html       사람이 읽는 전체 문서. 목차 + 본문 + FR/NFR + 원가표 + 미정 목록. 인쇄 가능.
//   overview.html  인포그래픽 한 장. In/Out 대조 · FR 의존성 흐름 · 원가 · 미정.
//
// **외부 요청이 하나도 없어야 한다** (§B4 AC3). CSS는 인라인, 글꼴은 시스템 스택,
// 그림은 인라인 SVG이며 `xmlns`조차 붙이지 않는다(HTML 파서가 알아서 넣는다) — 그래야
// 파일 안에 URL이 단 하나도 남지 않는다. 개정안 본문은 Mermaid를 제안했지만 Mermaid는 CDN 스크립트를
// 요구하므로 AC3과 충돌한다. 의존성 그래프는 SVG로 직접 그린다 — 오프라인에서 열리고
// 인쇄된다는 조건이 라이브러리 편의보다 우선한다.

import { ENGINE_MODEL } from '../config.js';
import { SECTION_IDS, type PRDState, type Requirement } from '../types/prd.js';
import type { ValidationIssue } from '../validator/validate.js';
import { escapeHtml, mdToHtml } from './markdown.js';
import { forbiddenList, orderByDependency } from './render.js';

const BASE_CSS = `
:root {
  --fg: #1a1a1a; --dim: #6b7280; --line: #e2e2e2; --bg: #ffffff; --panel: #f7f7f8;
  --accent: #2f5fd0; --todo: #b45309; --todo-bg: #fef3c7; --unver: #9333ea; --ok: #15803d;
}
@media (prefers-color-scheme: dark) {
  :root {
    --fg: #e8e8e8; --dim: #9aa0a6; --line: #333; --bg: #16171a; --panel: #1e2024;
    --accent: #7aa2f7; --todo: #fbbf24; --todo-bg: #3b2f14; --unver: #c084fc; --ok: #4ade80;
  }
}
* { box-sizing: border-box; }
body {
  margin: 0; background: var(--bg); color: var(--fg);
  font: 15px/1.7 -apple-system, BlinkMacSystemFont, "Segoe UI", "Noto Sans KR", sans-serif;
}
.wrap { max-width: 900px; margin: 0 auto; padding: 40px 24px 80px; }
h1 { font-size: 28px; margin: 0 0 6px; line-height: 1.3; }
h2 { font-size: 20px; margin: 36px 0 10px; padding-bottom: 6px; border-bottom: 1px solid var(--line); }
h3 { font-size: 16px; margin: 22px 0 6px; }
h4 { font-size: 14px; margin: 16px 0 4px; }
p, li { overflow-wrap: anywhere; }
ul, ol { padding-left: 22px; }
li.task { list-style: none; margin-left: -18px; }
code {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 0.88em;
  background: var(--panel); padding: 1px 5px; border-radius: 4px;
}
pre { background: var(--panel); padding: 12px 14px; border-radius: 8px; overflow-x: auto; }
pre code { background: none; padding: 0; }
blockquote {
  margin: 14px 0; padding: 10px 16px; border-left: 3px solid var(--accent);
  background: var(--panel); border-radius: 0 6px 6px 0;
}
blockquote p { margin: 6px 0; }
table { border-collapse: collapse; width: 100%; margin: 12px 0; font-size: 13px; }
th, td { border: 1px solid var(--line); padding: 6px 10px; text-align: left; vertical-align: top; }
th { background: var(--panel); font-weight: 600; }
hr { border: 0; border-top: 1px solid var(--line); margin: 28px 0; }
.meta { color: var(--dim); font-size: 13px; margin: 0 0 24px; }
.tag-unverified { color: var(--unver); font-weight: 600; }
.tag-todo { color: var(--todo); font-weight: 600; }
.callout {
  border: 1px solid var(--todo); background: var(--todo-bg); color: var(--fg);
  border-radius: 8px; padding: 14px 18px; margin: 20px 0;
}
.callout.pass { border-color: var(--ok); background: transparent; }
.callout h2 { margin-top: 0; border: 0; font-size: 16px; }
.toc { background: var(--panel); border-radius: 8px; padding: 14px 20px; margin: 24px 0; }
.toc ol { margin: 6px 0 0; }
.toc a { color: var(--accent); text-decoration: none; }
.toc a:hover { text-decoration: underline; }
figure { margin: 0; }
.graph { margin: 14px 0; color: var(--fg); text-align: center; }
.graph svg { max-width: 100%; height: auto; }
.graph figcaption { text-align: left; }
@media print {
  :root {
    --fg: #000; --dim: #555; --line: #bbb; --bg: #fff; --panel: #f4f4f4;
    --todo-bg: #fdf6dd; --accent: #234;
  }
  body { font-size: 11pt; }
  .wrap { max-width: none; padding: 0; }
  h2 { page-break-after: avoid; }
  table, pre, .card, figure { page-break-inside: avoid; }
}
`;

function page(title: string, extraCss: string, body: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
<div class="wrap">
${body}
</div>
</body>
</html>
`;
}

/** 미정·미검증 블록. 두 HTML 산출물이 같은 것을 쓴다 — §B4 AC4. */
function undecidedHtml(state: PRDState, issues: readonly ValidationIssue[]): string {
  const pending = issues.filter((i) => i.severity === 'incomplete');
  const terms = state.unverifiedTerms;

  if (pending.length === 0 && terms.length === 0) {
    return `<section class="callout pass" id="undecided">
<h2>✅ 미정 항목 없음</h2>
<p>완성 기준 전 항목을 통과했고 <span class="tag-unverified">[미검증]</span> 항목도 없다.</p>
</section>`;
  }

  const parts = [`<section class="callout" id="undecided">`, `<h2>⚠️ 미정 · 미검증 — 개발 착수 전 확인</h2>`];

  if (pending.length > 0) {
    parts.push(
      `<p><strong>미정 ${pending.length}건.</strong> 작성자가 확인하고 <strong>의도적으로 비워둔</strong> 항목이다.`,
      ` 개발 AI는 이 자리를 임의로 채우지 말고 사람에게 물을 것.</p>`,
      '<ul>',
      ...pending.map((i) =>
        `<li>☐ <strong>${escapeHtml(i.sectionId ?? '전역')}</strong> ${escapeHtml(i.message)} <code>${escapeHtml(i.code)}</code></li>`),
      '</ul>',
    );
  }
  if (terms.length > 0) {
    parts.push(
      `<p><strong><span class="tag-unverified">[미검증]</span> ${terms.length}건.</strong> 공식 문서로 확인할 것.</p>`,
      '<ul>',
      ...terms.map((t) => `<li>☐ ${escapeHtml(t)}</li>`),
      '</ul>',
    );
  }
  parts.push('</section>');
  return parts.join('\n');
}

function reqTable(reqs: readonly Requirement[]): string {
  if (reqs.length === 0) return '<p class="meta">(등록된 항목 없음)</p>';
  return [
    '<table><thead><tr><th>ID</th><th>제목</th><th>우선순위</th><th>인수 기준</th><th>의존</th></tr></thead><tbody>',
    ...reqs.map((r) => [
      '<tr>',
      `<td><code>${escapeHtml(r.id)}</code></td>`,
      `<td><strong>${escapeHtml(r.title)}</strong><br><span class="meta">${escapeHtml(r.description)}</span></td>`,
      `<td>${escapeHtml(r.priority)}</td>`,
      `<td><ul>${r.acceptanceCriteria.map((a) => `<li class="task">☐ ${escapeHtml(a)}</li>`).join('')}</ul></td>`,
      `<td>${r.dependsOn.length > 0 ? escapeHtml(r.dependsOn.join(', ')) : '—'}</td>`,
      '</tr>',
    ].join('')),
    '</tbody></table>',
  ].join('\n');
}

function costTable(state: PRDState): string {
  if (state.costModel.length === 0) return '';
  const total = state.costModel.reduce((s, c) => s + c.estimatedCost, 0);
  return [
    '<table><thead><tr><th>항목</th><th>단위</th><th>추정(USD)</th><th>검증</th><th>비고</th></tr></thead><tbody>',
    ...state.costModel.map((c) =>
      `<tr><td>${escapeHtml(c.item)}</td><td>${escapeHtml(c.unit)}</td><td>$${c.estimatedCost}</td>`
      + `<td>${c.verified ? '✅' : '<span class="tag-unverified">[미검증]</span>'}</td>`
      + `<td>${escapeHtml(c.note)}</td></tr>`),
    `<tr><th colspan="2">합계</th><th>$${total.toFixed(2)}</th><th colspan="2"></th></tr>`,
    '</tbody></table>',
  ].join('\n');
}

// --- FR 의존성 흐름 (인라인 SVG) --------------------------------------------

/** 의존 깊이. 순환이 있으면 0으로 떨어뜨린다 — 그림 하나 때문에 멈추지 않는다. */
function layerOf(reqs: readonly Requirement[]): Map<string, number> {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const depth = new Map<string, number>();

  function walk(id: string, seen: ReadonlySet<string>): number {
    const cached = depth.get(id);
    if (cached !== undefined) return cached;
    if (seen.has(id)) return 0;                       // 순환
    const r = byId.get(id);
    if (!r) return 0;
    const next = new Set(seen).add(id);
    const deps = r.dependsOn.filter((d) => byId.has(d));
    const d = deps.length === 0 ? 0 : 1 + Math.max(...deps.map((x) => walk(x, next)));
    depth.set(id, d);
    return d;
  }

  for (const r of reqs) walk(r.id, new Set());
  return depth;
}

/**
 * FR 의존성을 층으로 나눠 그린다. 위층이 선행이고 아래로 내려갈수록 나중 작업이다.
 * 라이브러리 없이 그리므로 곡선을 쓰지 않고 직선으로만 잇는다.
 */
export function dependencySvg(reqs: readonly Requirement[]): string {
  if (reqs.length === 0) return '<p class="meta">(FR이 아직 정의되지 않았다)</p>';

  const depth = layerOf(reqs);
  const layers: Requirement[][] = [];
  for (const r of orderByDependency(reqs)) {
    const d = depth.get(r.id) ?? 0;
    (layers[d] ??= []).push(r);
  }

  const BW = 128, BH = 38, GX = 16, GY = 56, PAD = 12;
  const widest = Math.max(...layers.map((l) => l.length));
  const width = PAD * 2 + widest * BW + (widest - 1) * GX;
  const height = PAD * 2 + layers.length * BH + (layers.length - 1) * GY;

  const pos = new Map<string, { x: number; y: number }>();
  layers.forEach((layer, li) => {
    const rowW = layer.length * BW + (layer.length - 1) * GX;
    const startX = (width - rowW) / 2;
    layer.forEach((r, i) => {
      pos.set(r.id, { x: startX + i * (BW + GX), y: PAD + li * (BH + GY) });
    });
  });

  const edges: string[] = [];
  for (const r of reqs) {
    const to = pos.get(r.id);
    if (!to) continue;
    for (const dep of r.dependsOn) {
      const from = pos.get(dep);
      if (!from) continue;
      edges.push(
        `<line x1="${(from.x + BW / 2).toFixed(1)}" y1="${from.y + BH}"`
        + ` x2="${(to.x + BW / 2).toFixed(1)}" y2="${to.y}"`
        + ` stroke="currentColor" stroke-opacity=".35" stroke-width="1.5" marker-end="url(#a)"/>`,
      );
    }
  }

  const boxes = reqs.flatMap((r) => {
    const p = pos.get(r.id);
    if (!p) return [];
    const title = r.title.length > 15 ? `${r.title.slice(0, 14)}…` : r.title;
    return [
      `<g><rect x="${p.x}" y="${p.y}" width="${BW}" height="${BH}" rx="7"`
      + ` fill="var(--panel)" stroke="currentColor" stroke-opacity=".3"/>`
      + `<text x="${p.x + 8}" y="${p.y + 16}" font-size="11" font-weight="700" fill="currentColor">${escapeHtml(r.id)}</text>`
      + `<text x="${p.x + 8}" y="${p.y + 30}" font-size="10.5" fill="currentColor" fill-opacity=".72">${escapeHtml(title)}</text>`
      + `<title>${escapeHtml(`${r.id}: ${r.title}`)}</title></g>`,
    ];
  });

  return `<figure class="graph">
<svg viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img"
     aria-label="FR 의존성 흐름도">
<defs><marker id="a" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
<path d="M0 0 L8 4 L0 8 z" fill="currentColor" fill-opacity=".45"/></marker></defs>
${edges.join('\n')}
${boxes.join('\n')}
</svg>
<figcaption class="meta">위층이 선행 작업이다. 화살표를 거슬러 올라가며 만든다. 층 ${layers.length}개 · FR ${reqs.length}개</figcaption>
</figure>`;
}

// --- PRD.html ---------------------------------------------------------------

/** 사람이 읽는 전체 문서 — 목차 · 본문 · FR/NFR 표 · 원가표 · 미정 목록. */
export function renderPrdHtml(state: PRDState, issues: readonly ValidationIssue[]): string {
  const name = state.projectName || '(제목 미정)';
  const shown = SECTION_IDS.filter((id) => {
    const s = state.sections[id];
    return !(s.status === 'empty' && s.content.trim() === '');
  });

  const body: string[] = [
    `<h1>${escapeHtml(name)} — PRD</h1>`,
    `<p class="meta">v${escapeHtml(state.version)} · 인터뷰 ${state.turn}턴 · `
    + `작성 엔진 ${escapeHtml(ENGINE_MODEL.id)}${ENGINE_MODEL.verified ? '' : ' <span class="tag-unverified">[미검증 단가]</span>'}</p>`,
    undecidedHtml(state, issues),
    '<nav class="toc"><strong>목차</strong><ol>',
    ...shown.map((id) => `<li><a href="#${id}">${escapeHtml(state.sections[id].title)}</a></li>`),
    '</ol></nav>',
  ];

  for (const id of shown) {
    const s = state.sections[id];
    body.push(`<h2 id="${id}">${escapeHtml(id)}. ${escapeHtml(s.title)}</h2>`);
    body.push(mdToHtml(s.content.trim()));

    if (id === 'S5') {
      body.push('<h3>기능 요구사항</h3>', reqTable(state.requirements.filter((r) => r.section === 'FR')));
      body.push('<h3>의존성 흐름</h3>', dependencySvg(state.requirements.filter((r) => r.section === 'FR')));
    }
    if (id === 'S6') {
      body.push('<h3>비기능 요구사항</h3>', reqTable(state.requirements.filter((r) => r.section === 'NFR')));
    }
    if (id === 'S9') body.push(costTable(state));
    if (id === 'S10') {
      if (state.openQuestions.length > 0) {
        body.push('<h3>미해결 질문</h3><ol>',
          ...state.openQuestions.map((q) => `<li>${escapeHtml(q)}</li>`), '</ol>');
      }
      if (state.assumptions.length > 0) {
        body.push('<h3>가정</h3><ul>',
          ...state.assumptions.map((a) =>
            `<li>${escapeHtml(a.text)} <span class="meta">(출처: ${escapeHtml(a.source)})</span></li>`),
          '</ul>');
      }
    }
  }

  body.push(
    '<h2>Handoff Note (개발 AI에게)</h2>',
    '<ul>',
    '<li>본 문서의 <strong>FR/NFR ID를 작업 추적 단위</strong>로 사용할 것. 커밋 메시지에 ID를 남길 것.</li>',
    '<li><strong>Out of Scope 항목은 구현하지 말 것.</strong> 좋은 아이디어라도 추가하지 말 것.</li>',
    '<li>모델명·가격·API 스펙을 기억에 의존해 쓰지 말 것. 공식 문서를 확인할 것.</li>',
    '<li>위 미정 항목은 해당 코드 작성 <strong>직전에</strong> 사람에게 확인할 것.</li>',
    '</ul>',
    `<p class="meta">이 문서는 PRD Architect가 ${state.turn}턴의 인터뷰를 거쳐 상태 JSON에서 결정적으로 조립했다.</p>`,
  );

  return page(`${name} — PRD`, '', body.join('\n'));
}

// --- overview.html (인포그래픽) ----------------------------------------------

const OVERVIEW_CSS = `
.hero { border-bottom: 2px solid var(--fg); padding-bottom: 18px; margin-bottom: 8px; }
.hero h1 { font-size: 32px; }
.stats { display: flex; flex-wrap: wrap; gap: 10px; margin: 20px 0 28px; }
.stat {
  flex: 1 1 120px; background: var(--panel); border-radius: 10px;
  padding: 12px 14px; border: 1px solid var(--line);
}
.stat b { display: block; font-size: 22px; line-height: 1.2; }
.stat span { font-size: 11px; color: var(--dim); text-transform: uppercase; letter-spacing: .04em; }
.split { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; margin: 14px 0; }
.card { border: 1px solid var(--line); border-radius: 10px; padding: 14px 18px; background: var(--panel); }
.card h3 { margin-top: 0; }
.card.in { border-left: 4px solid var(--ok); }
.card.out { border-left: 4px solid var(--todo); }
@media (max-width: 640px) { .split { grid-template-columns: 1fr; } }
@media print { .split { grid-template-columns: 1fr 1fr; } }
`;

/** 인포그래픽 한 장 — 이 앱에서 가장 값나가는 산출물이다 (§B4). */
export function renderOverviewHtml(state: PRDState, issues: readonly ValidationIssue[]): string {
  const name = state.projectName || '(제목 미정)';
  const frs = state.requirements.filter((r) => r.section === 'FR');
  const nfrs = state.requirements.filter((r) => r.section === 'NFR');
  const pending = issues.filter((i) => i.severity === 'incomplete').length;
  const total = state.costModel.reduce((s, c) => s + c.estimatedCost, 0);
  const forbidden = forbiddenList(state);
  const oneLiner = state.sections.S1.content.trim().split('\n').find((l) => l.trim() !== '') ?? '';

  const body: string[] = [
    `<header class="hero">`,
    `<h1>${escapeHtml(name)}</h1>`,
    oneLiner ? `<p>${escapeHtml(oneLiner.replace(/^#+\s*/, ''))}</p>` : '',
    `<p class="meta">v${escapeHtml(state.version)} · 인터뷰 ${state.turn}턴 · 한 장 요약</p>`,
    `</header>`,

    '<div class="stats">',
    `<div class="stat"><b>${frs.length}</b><span>기능 요구사항</span></div>`,
    `<div class="stat"><b>${nfrs.length}</b><span>비기능 요구사항</span></div>`,
    `<div class="stat"><b>${state.openQuestions.length}</b><span>미해결 질문</span></div>`,
    `<div class="stat"><b>${pending}</b><span>미정 항목</span></div>`,
    ...(state.costModel.length > 0
      ? [`<div class="stat"><b>$${total.toFixed(2)}</b><span>추정 원가</span></div>`]
      : []),
    '</div>',

    '<h2>MVP 범위</h2>',
    '<div class="split">',
    `<div class="card in"><h3>✅ 만든다 (In)</h3>${mdToHtml(state.sections.S2.content.trim()) || '<p class="meta">(S2 미작성)</p>'}</div>`,
    `<div class="card out"><h3>⛔ 만들지 않는다 (Out)</h3>${
      forbidden.length > 0
        ? `<ul>${forbidden.map((f) => `<li>${escapeHtml(f)}</li>`).join('')}</ul>`
        : mdToHtml(state.sections.S3.content.trim()) || '<p class="meta">(S3 미작성)</p>'
    }</div>`,
    '</div>',

    '<h2>사용자 플로우</h2>',
    mdToHtml(state.sections.S4.content.trim()) || '<p class="meta">(S4 미작성)</p>',

    '<h2>FR 의존성 흐름</h2>',
    dependencySvg(frs),
  ];

  if (state.costModel.length > 0) body.push('<h2>원가</h2>', costTable(state));

  body.push(undecidedHtml(state, issues));
  return page(`${name} — 한 장 요약`, OVERVIEW_CSS, body.join('\n'));
}
