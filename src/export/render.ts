// 내보내기 렌더러 — FR-008 / FR-009 / FR-013.
//
// 스펙 설계 원칙 3: **최종 문서는 생성이 아니라 조립이다.**
// 여기 있는 함수는 전부 순수 함수이며 LLM을 호출하지 않는다.

import { ENGINE_MODEL } from '../config.js';
import { SECTION_IDS, type PRDState, type Requirement, type SectionId } from '../types/prd.js';
import type { ValidationIssue } from '../validator/validate.js';

/** 압축본 상한 — FR-009 AC2. 초과 시 Must만 남긴다. */
export const COMPACT_LIMIT = 4000;

function req(state: PRDState, kind: 'FR' | 'NFR'): Requirement[] {
  return state.requirements.filter((r) => r.section === kind);
}

function renderRequirement(r: Requirement): string {
  const deps = r.dependsOn.length > 0 ? `\n- **의존성:** ${r.dependsOn.join(', ')}` : '';
  return [
    `### ${r.id}: ${r.title}`,
    `- **설명:** ${r.description}`,
    '- **AC:**',
    ...r.acceptanceCriteria.map((ac) => `  - [ ] ${ac}`),
    `- **우선순위:** ${r.priority}${deps}`,
  ].join('\n');
}

/** S3(Out of Scope)를 "구현 금지" 목록으로 뽑는다 — FR-009 AC1, FR-013 AC1. */
export function forbiddenList(state: PRDState): string[] {
  const out: string[] = [];
  for (const raw of state.sections.S3.content.split('\n')) {
    const line = raw.trim();
    const m = /^(?:[-*+]|\d+\.)\s+(.*)$/.exec(line);
    if (m?.[1]) out.push(m[1].replace(/\*\*/g, '').trim());
    else if (/^\|/.test(line) && !/^\|[\s:|-]+\|$/.test(line)) {
      const cell = line.split('|')[1]?.trim();
      if (cell && cell !== '항목') out.push(cell.replace(/\*\*/g, ''));
    }
  }
  return out;
}

// --- FR-008 전체본 ----------------------------------------------------------

export function renderFullPRD(state: PRDState): string {
  const now = state.sections.S0.updatedAtTurn;
  const parts: string[] = [
    `# ${state.projectName || '(제목 미정)'} — PRD`,
    '',
    `- **버전:** ${state.version}`,
    `- **인터뷰 턴 수:** ${state.turn}`,
    `- **작성 엔진:** ${ENGINE_MODEL.id}${ENGINE_MODEL.verified ? '' : ' [미검증 단가]'}`,
    `- **최종 갱신 턴:** ${now}`,
    '',
    '---',
    '',
  ];

  for (const id of SECTION_IDS) {
    const s = state.sections[id];
    if (s.status === 'empty' && s.content.trim() === '') continue;

    parts.push(`## ${id}. ${s.title}`, '');
    parts.push(s.content.trim(), '');

    // 요구사항은 상태에서 렌더링한다 — 섹션 본문에 중복 서술하지 않는다 (스펙 §4.2)
    if (id === 'S5') {
      const frs = req(state, 'FR');
      if (frs.length > 0) parts.push(...frs.map(renderRequirement), '');
    }
    if (id === 'S6') {
      const nfrs = req(state, 'NFR');
      if (nfrs.length > 0) parts.push(...nfrs.map(renderRequirement), '');
    }
    if (id === 'S9' && state.costModel.length > 0) {
      parts.push(
        '| 항목 | 단위 | 추정 비용(USD) | 검증 | 비고 |',
        '|---|---|---|---|---|',
        ...state.costModel.map(
          (c) => `| ${c.item} | ${c.unit} | $${c.estimatedCost} | ${c.verified ? '✅' : '[미검증]'} | ${c.note} |`,
        ),
        '',
        `**합계: $${state.costModel.reduce((s, c) => s + c.estimatedCost, 0).toFixed(2)}**`,
        '',
      );
    }
    if (id === 'S10') {
      if (state.openQuestions.length > 0) {
        parts.push('### 미해결 질문', '', ...state.openQuestions.map((q, i) => `${i + 1}. ${q}`), '');
      }
      if (state.assumptions.length > 0) {
        parts.push('### 가정', '',
          ...state.assumptions.map((a) => `- ${a.text} *(출처: ${a.source})*`), '');
      }
    }
    parts.push('---', '');
  }

  if (state.unverifiedTerms.length > 0) {
    parts.push('## 부록 — [미검증] 항목', '',
      '아래는 확인되지 않은 외부 정보다. 개발 착수 전 공식 문서에서 검증할 것.', '',
      ...state.unverifiedTerms.map((t) => `- ${t}`), '', '---', '');
  }

  parts.push(renderHandoffNote(state));
  return parts.join('\n');
}

/**
 * 미완성 상태로 내보낼 때 문서 맨 위에 붙는 경고 배너.
 * 검증기가 차단한 항목을 그대로 나열한다 — 배너를 붙였다고 검증 결과가 통과로 바뀌지는 않는다.
 */
export function renderDraftBanner(issues: readonly ValidationIssue[]): string {
  const pending = issues.filter((i) => i.severity === 'incomplete');

  // 통과했어도 침묵하지 않는다. 문서를 받은 개발 AI가 검증을 거쳤다는 사실 자체를 알아야 한다.
  if (pending.length === 0) {
    return [
      '> ✅ **검증 통과** — 완성 기준 전 항목을 충족했다.',
      '',
      '---',
      '',
    ].join('\n');
  }

  return [
    `> ⚠️ **미정 ${pending.length}건 — 이 문서는 아직 완성본이 아니다**`,
    '>',
    '> 아래 항목은 작성자가 확인하고 **의도적으로 비워둔 채** 내보낸 것이다.',
    '> **개발 AI에게: 이 항목들을 임의로 채워서 구현하지 말 것.** 필요하면 사람에게 물을 것.',
    '>',
    ...pending.map((i) => `> - **${i.sectionId ?? '전역'}** ${i.message} \`${i.code}\``),
    '',
    '---',
    '',
  ].join('\n');
}

/**
 * 정식 내보내기 경로 — 개정안 #02 §A.
 *
 * 미완성 여부와 무관하게 항상 문서가 나온다. 대신 맨 위에 미정 목록이 반드시 붙는다.
 * 이것이 "차단하지 않는다"와 "미완성을 숨기지 않는다"를 동시에 지키는 유일한 방법이다.
 */
export function renderDraft(state: PRDState, issues: readonly ValidationIssue[]): string {
  return renderDraftBanner(issues) + renderFullPRD(state);
}

/** 문서 말미에 자동 삽입된다 — FR-008 AC3. 스펙 §14를 이 프로젝트에 맞게 조립한다. */
export function renderHandoffNote(state: PRDState): string {
  const forbidden = forbiddenList(state);
  return [
    '## Handoff Note (개발 AI에게)',
    '',
    '- 본 문서의 **FR/NFR ID를 작업 추적 단위**로 사용할 것. 커밋 메시지에 ID를 남길 것.',
    '- **아래 Out of Scope 항목은 구현하지 말 것.** 좋은 아이디어라도 추가하지 말 것.',
    ...(forbidden.length > 0
      ? forbidden.map((f) => `  - ${f}`)
      : ['  - (S3에 명시된 항목 없음)']),
    '- `Suggestion:` 접두어가 붙은 기술 선택은 재량으로 변경 가능하나 **변경 시 사유를 기록**할 것.',
    '  접두어가 없는 항목은 제약이므로 변경 금지.',
    '- **모델명·가격·API 스펙을 기억에 의존해 코드에 쓰지 말 것.** 공식 문서를 확인하고,',
    '  확인 불가하면 설정 파일에 `TODO: 확인 필요` 주석과 함께 남기고 사용자에게 알릴 것.',
    '- 미해결 질문은 해당 코드 작성 **직전에** 사용자에게 확인할 것. 임의 결정하지 말 것.',
    '- 본 문서 수정이 필요하면 임의로 고치지 말고 변경 요청을 사용자에게 제시할 것.',
    '',
    `*이 문서는 PRD Architect가 ${state.turn}턴의 인터뷰를 거쳐 상태 JSON에서 결정적으로 조립했다.*`,
  ].join('\n');
}

// --- FR-009 압축본 ----------------------------------------------------------

function compactBody(state: PRDState, onlyMust: boolean): string {
  const frs = req(state, 'FR').filter((r) => !onlyMust || r.priority === 'Must');
  const forbidden = forbiddenList(state);

  const lines: string[] = [
    `# ${state.projectName || '(제목 미정)'} — 개발 착수 지시`,
    '',
    '## 제약 (변경 불가)',
    state.sections.S0.content.trim() || '(S0 미작성)',
    '',
    '## 기술 스택',
    state.sections.S8.content.trim() || '(S8 미작성)',
    '',
    '## 만들 것',
    state.sections.S2.content.trim() || '(S2 미작성)',
    '',
    '## 구현 금지 (Out of Scope)',
    ...(forbidden.length > 0 ? forbidden.map((f) => `- ${f}`) : ['- (명시된 항목 없음)']),
    '',
    `## 기능 요구사항${onlyMust ? ' (Must만 — 분량 초과로 축약됨)' : ''}`,
    '',
  ];

  for (const r of frs) {
    lines.push(`### ${r.id}: ${r.title} [${r.priority}]`);
    lines.push(r.description);
    lines.push(...r.acceptanceCriteria.map((ac) => `- [ ] ${ac}`));
    if (r.dependsOn.length > 0) lines.push(`- 의존성: ${r.dependsOn.join(', ')}`);
    lines.push('');
  }

  const nfrs = req(state, 'NFR');
  if (nfrs.length > 0) {
    lines.push('## 비기능 요구사항', '');
    lines.push(...nfrs.map((r) => `- **${r.id}** ${r.title}: ${r.description}`));
    lines.push('');
  }

  if (state.unverifiedTerms.length > 0) {
    lines.push('## [미검증] — 착수 전 확인 필요', '');
    lines.push(...state.unverifiedTerms.map((t) => `- ${t}`));
  }

  return lines.join('\n');
}

/** 전체 PRD는 길어서 코딩 착수 시 산만해진다. 압축본은 제약·범위·FR·AC만 담는다. */
export function renderCompact(state: PRDState): string {
  const full = compactBody(state, false);
  return full.length <= COMPACT_LIMIT ? full : compactBody(state, true);
}

// --- FR-013 개발 환경·에이전트 세팅 지침 -------------------------------------

/**
 * FR 의존성을 위반하지 않는 순서로 정렬한다 — FR-013 AC2.
 * 순환이 있으면 남은 것을 원래 순서로 붙인다(멈추지 않는다).
 */
export function orderByDependency(reqs: readonly Requirement[]): Requirement[] {
  const byId = new Map(reqs.map((r) => [r.id, r]));
  const done = new Set<string>();
  const out: Requirement[] = [];

  let progressed = true;
  while (progressed) {
    progressed = false;
    for (const r of reqs) {
      if (done.has(r.id)) continue;
      // 목록 밖의 의존성은 무시한다 — 이미 만들어졌거나 범위 밖이다
      const ready = r.dependsOn.every((d) => !byId.has(d) || done.has(d));
      if (ready) {
        out.push(r);
        done.add(r.id);
        progressed = true;
      }
    }
  }
  for (const r of reqs) if (!done.has(r.id)) out.push(r); // 순환 잔여
  return out;
}

/** S8 기술 스택에서 권한 allowlist 후보를 유도한다 — FR-013. */
export function permissionCandidates(s8: string): string[] {
  const t = s8.toLowerCase();
  const out = new Set<string>(['Read', 'Edit', 'Write', 'Grep', 'Glob', 'Bash(ls:*)', 'Bash(mkdir:*)']);
  const has = (...ks: string[]) => ks.some((k) => t.includes(k));

  if (has('npm', 'node', 'vite', 'react', 'next', 'typescript', 'ts')) {
    out.add('Bash(npm run:*)'); out.add('Bash(npm test:*)'); out.add('Bash(npm install:*)');
  }
  if (has('vitest', 'jest')) out.add('Bash(npx vitest:*)');
  if (has('python', 'django', 'fastapi', 'flask')) {
    out.add('Bash(python:*)'); out.add('Bash(pip install:*)'); out.add('Bash(pytest:*)');
  }
  if (has('docker')) out.add('Bash(docker compose:*)');
  if (has('git', 'github')) {
    out.add('Bash(git status)'); out.add('Bash(git diff:*)'); out.add('Bash(git log:*)');
  }
  return [...out];
}

export function renderSetupGuide(state: PRDState): string {
  const name = state.projectName || '(제목 미정)';
  const forbidden = forbiddenList(state);
  const frs = orderByDependency(req(state, 'FR'));
  const perms = permissionCandidates(state.sections.S8.content);

  const milestones: string[] = [];
  const testable = frs.filter((r) => r.acceptanceCriteria.length >= 2);
  testable.slice(0, 8).forEach((r, i) => {
    milestones.push(`${i + 1}. **M${i + 1} — ${r.id} ${r.title}**${r.dependsOn.length ? ` (선행: ${r.dependsOn.join(', ')})` : ''}`);
  });
  if (frs.length > 8) milestones.push(`${9}. **M9 이후** — 나머지 ${frs.length - 8}개 FR을 같은 방식으로 이어간다`);

  return [
    `# ${name} — 개발 환경 및 에이전트 세팅 지침`,
    '',
    '이 문서는 PRD와 함께 개발 AI에게 전달한다. PRD가 "무엇을"이라면 이것은 "어떻게 시작할지"다.',
    '',
    '## 1. `CLAUDE.md` 초안',
    '',
    '프로젝트 루트에 아래 내용으로 만든다. **짧게 유지할 것** — 매 턴 컨텍스트에 실린다.',
    '',
    '````markdown',
    `# ${name}`,
    '',
    state.sections.S1.content.trim().split('\n').slice(0, 6).join('\n') || '(S1 미작성)',
    '',
    '## 구현 금지 (Out of Scope)',
    ...(forbidden.length > 0 ? forbidden.map((f) => `- ${f}`) : ['- (명시된 항목 없음)']),
    '',
    '## 확정 제약 (변경 불가)',
    state.sections.S0.content.trim() || '(S0 미작성)',
    '',
    '## 개발 규칙',
    '- FR/NFR ID를 작업 단위로 삼는다. 커밋 메시지에 ID를 남긴다.',
    '- `Suggestion:` 항목만 재량 변경 가능하며, 변경 시 사유를 기록한다.',
    '- 모델명·가격·API 스펙을 기억으로 쓰지 않는다. 확인 불가하면 `TODO: 확인 필요`로 남기고 보고한다.',
    '- 미해결 질문은 해당 코드 작성 직전에 사용자에게 확인한다.',
    '````',
    '',
    '## 2. 문서 배치',
    '',
    '```',
    'CLAUDE.md              위 초안. 짧게.',
    'docs/PRD.md            전체 PRD. 통째로 읽지 말고 필요한 절만 조회.',
    'docs/PROGRESS.md       진행 상황과 결정 기록. 세션 시작 시 이것부터 읽는다.',
    '```',
    '',
    '긴 PRD를 매 세션 전문 로드하면 토큰이 반복 청구된다. 조회 전담 서브에이전트를 두고',
    '필요한 절만 원문 인용으로 받아오는 편이 싸다.',
    '',
    '## 3. 서브에이전트 제안',
    '',
    '`.claude/agents/` 에 둔다.',
    '',
    '| 이름 | 역할 | 모델 |',
    '|---|---|---|',
    '| `spec` | `docs/PRD.md`에서 해당 FR/절만 찾아 원문 인용으로 반환 | haiku |',
    ...(perms.some((p) => p.includes('vitest') || p.includes('pytest'))
      ? ['| `tests` | 테스트 실행·실패 진단. 긴 로그가 메인 컨텍스트에 쌓이지 않게 함 | sonnet |']
      : []),
    '',
    '## 4. 개발 순서',
    '',
    '아래는 FR 의존성을 위반하지 않는 순서다. 각 단계 완료 시 사용자 확인을 받는다.',
    '',
    ...(milestones.length > 0 ? milestones : ['(FR이 아직 정의되지 않았다)']),
    '',
    '**검증 가능한 것부터 만든다.** UI는 그다음이다.',
    '',
    '## 5. 권한 allowlist 후보',
    '',
    'S8 기술 스택에서 유도했다. `.claude/settings.json` 의 `permissions.allow` 에 넣으면',
    '반복 승인 요청이 줄어든다. 실제 적용 전 검토할 것.',
    '',
    '```json',
    JSON.stringify({ permissions: { allow: perms, deny: ['Read(./.env)', 'Read(./.env.*)'] } }, null, 2),
    '```',
    '',
    '## 6. 착수 전 확인',
    '',
    ...(state.openQuestions.length > 0
      ? state.openQuestions.map((q) => `- [ ] ${q}`)
      : ['- (미해결 질문 없음)']),
    ...(state.unverifiedTerms.length > 0
      ? ['', '**[미검증] 항목 — 공식 문서 확인 필요:**', ...state.unverifiedTerms.map((t) => `- [ ] ${t}`)]
      : []),
  ].join('\n');
}

// --- 개정안 #02 §B4 — 산출물 확장 -------------------------------------------

/**
 * 미정·[미검증] 목록 — **모든 산출물에 빠짐없이 들어간다** (§B4 AC4).
 *
 * 원칙 4 개정(차단→고지)의 유일한 방어선이 이것이다. 미완성이 문서에서 사라지면
 * 개발 AI가 그 자리를 임의로 채우고, 그러면 이 앱의 존재 이유가 없어진다.
 */
export function renderUndecided(state: PRDState, issues: readonly ValidationIssue[]): string {
  const pending = issues.filter((i) => i.severity === 'incomplete');
  const lines: string[] = ['## 미정 · 미검증 (개발 착수 전 확인)', ''];

  if (pending.length === 0) {
    lines.push('- ✅ 완성 기준 전 항목 통과. 비워둔 항목 없음.');
  } else {
    lines.push(`**미정 ${pending.length}건 — 작성자가 확인하고 의도적으로 비워둔 항목이다.**`, '');
    lines.push('**개발 AI에게: 아래를 임의로 채워서 구현하지 말 것.** 필요하면 사람에게 물을 것.', '');
    lines.push(...pending.map((i) => `- [ ] **${i.sectionId ?? '전역'}** ${i.message} \`${i.code}\``));
  }

  lines.push('');
  if (state.unverifiedTerms.length > 0) {
    lines.push(`**[미검증] ${state.unverifiedTerms.length}건 — 공식 문서로 확인할 것.**`, '');
    lines.push(...state.unverifiedTerms.map((t) => `- [ ] ${t}`));
  } else {
    lines.push('**[미검증] 항목 없음.**');
  }

  return lines.join('\n');
}

/** FR 의존성을 위반하지 않는 순서의 착수 체크리스트 — §B4 (AI용 `TASKS.md`). */
export function renderTasks(state: PRDState, issues: readonly ValidationIssue[]): string {
  const frs = orderByDependency(req(state, 'FR'));
  const nfrs = req(state, 'NFR');
  const lines: string[] = [
    `# ${state.projectName || '(제목 미정)'} — 작업 체크리스트`,
    '',
    `v${state.version} · FR ${frs.length}개 · NFR ${nfrs.length}개`,
    '',
    '아래는 **의존성을 위반하지 않는 순서**다. 위에서부터 하나씩 끝내고 커밋 메시지에 ID를 남긴다.',
    '',
  ];

  if (frs.length === 0) {
    lines.push('- (FR이 아직 정의되지 않았다)', '');
  } else {
    for (const r of frs) {
      const dep = r.dependsOn.length > 0 ? ` — 선행: ${r.dependsOn.join(', ')}` : '';
      lines.push(`- [ ] **${r.id}** ${r.title} \`${r.priority}\`${dep}`);
      lines.push(...r.acceptanceCriteria.map((ac) => `  - [ ] ${ac}`));
    }
    lines.push('');
  }

  if (nfrs.length > 0) {
    lines.push('## 비기능 요구사항 — 기능 구현과 병행해 확인한다', '');
    for (const r of nfrs) {
      lines.push(`- [ ] **${r.id}** ${r.title}`);
      lines.push(...r.acceptanceCriteria.map((ac) => `  - [ ] ${ac}`));
    }
    lines.push('');
  }

  lines.push(renderUndecided(state, issues));
  return lines.join('\n');
}

/** 개발 AI의 프로젝트 지침 — §B4 (AI용 `CLAUDE.md`). 짧게 유지한다. 매 턴 컨텍스트에 실린다. */
export function renderClaudeMd(state: PRDState, issues: readonly ValidationIssue[]): string {
  const forbidden = forbiddenList(state);
  return [
    `# ${state.projectName || '(제목 미정)'}`,
    '',
    state.sections.S1.content.trim().split('\n').slice(0, 6).join('\n') || '(S1 미작성)',
    '',
    '전체 PRD: `docs/PRD.md` · 작업 목록: `TASKS.md` · 환경 세팅: `SETUP.md`',
    '',
    '## 구현 금지 (Out of Scope)',
    '',
    '**좋은 아이디어라도 추가하지 않는다.**',
    '',
    ...(forbidden.length > 0 ? forbidden.map((f) => `- ${f}`) : ['- (S3에 명시된 항목 없음)']),
    '',
    '## 확정 제약 (변경 불가)',
    '',
    state.sections.S0.content.trim() || '(S0 미작성)',
    '',
    '## 개발 규칙',
    '',
    '- **FR/NFR ID가 작업 단위.** 커밋 메시지에 ID를 남긴다.',
    '- `Suggestion:` 항목만 재량 변경 가능하며 **변경 시 사유를 기록**한다. 없는 항목은 제약이다.',
    '- **모델명·가격·API 스펙을 기억으로 쓰지 않는다.** 공식 문서를 확인하고, 불가하면',
    '  설정 파일에 `TODO: 확인 필요`를 남기고 사용자에게 보고한다.',
    '- 아래 미정 항목은 **해당 코드 작성 직전에** 사용자에게 확인한다. 임의 결정 금지.',
    '- PRD 수정이 필요하면 직접 고치지 말고 변경 요청을 사용자에게 제시한다.',
    '',
    renderUndecided(state, issues),
  ].join('\n');
}
