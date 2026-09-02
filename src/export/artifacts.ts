// 산출물 카탈로그 — 개정안 #02 §B4.
//
// 산출물을 **읽는 주체별로** 나눈다. 사람이 읽을 것과 개발 AI가 먹을 것은 다른 문서다.
// UI는 이 배열만 알면 되고, 새 산출물이 생기면 여기 한 줄이 는다.

import type { PRDState } from '../types/prd.js';
import { serializeState } from '../storage/persist.js';
import type { ValidationIssue } from '../validator/validate.js';
import {
  renderClaudeMd, renderCompact, renderDraft, renderSetupGuide, renderTasks, renderUndecided,
} from './render.js';
import { renderOverviewHtml, renderPrdHtml } from './html.js';
import { makeZip } from './zip.js';
import { downloadText, slug } from './download.js';

export type ArtifactId =
  | 'prd-html' | 'overview' | 'prd-md' | 'prd-json' | 'compact' | 'claude' | 'tasks' | 'setup';

export type Audience = 'human' | 'ai';

export interface ArtifactDef {
  id: ArtifactId;
  label: string;
  /** 압축 파일 안에서 쓰는 이름. 프로젝트명을 붙이지 않는다 — zip 자체가 이름을 갖는다. */
  file: string;
  audience: Audience;
  mime: string;
  hint: string;
  /** 기본 선택 — §B4 "기본 선택은 PRD.html · overview.html · prd.json 3종" */
  defaultOn: boolean;
  render: (state: PRDState, issues: readonly ValidationIssue[]) => string;
}

export const ARTIFACTS: readonly ArtifactDef[] = [
  {
    id: 'prd-html',
    label: 'PRD (사람용)',
    file: 'PRD.html',
    audience: 'human',
    mime: 'text/html;charset=utf-8',
    hint: '목차·본문·요구사항 표·원가표. 브라우저에서 열고 인쇄한다.',
    defaultOn: true,
    render: renderPrdHtml,
  },
  {
    id: 'overview',
    label: '한 장 요약 (인포그래픽)',
    file: 'overview.html',
    audience: 'human',
    mime: 'text/html;charset=utf-8',
    hint: 'In/Out 대조 · FR 의존성 흐름 · 원가. 공유용 한 장.',
    defaultOn: true,
    render: renderOverviewHtml,
  },
  {
    id: 'prd-json',
    label: '상태 JSON',
    file: 'prd.json',
    audience: 'ai',
    mime: 'application/json',
    hint: '이 앱에 다시 불러오면 문서가 그대로 복원된다.',
    defaultOn: true,
    render: (state) => serializeState(state),
  },
  {
    id: 'prd-md',
    label: 'PRD 전체본 (.md)',
    file: 'PRD.md',
    audience: 'ai',
    mime: 'text/markdown;charset=utf-8',
    hint: '미정 배너가 맨 위에 붙은 전체 문서.',
    defaultOn: false,
    render: renderDraft,
  },
  {
    id: 'compact',
    label: '압축본',
    file: 'PRD-compact.md',
    audience: 'ai',
    mime: 'text/markdown;charset=utf-8',
    hint: '제약·범위·FR·AC만. 코딩 착수용.',
    defaultOn: false,
    render: (state, issues) => `${renderCompact(state)}\n\n${renderUndecided(state, issues)}\n`,
  },
  {
    id: 'claude',
    label: '프로젝트 지침',
    file: 'CLAUDE.md',
    audience: 'ai',
    mime: 'text/markdown;charset=utf-8',
    hint: '개발 AI 루트에 두는 짧은 지침 + 구현 금지 목록.',
    defaultOn: false,
    render: renderClaudeMd,
  },
  {
    id: 'tasks',
    label: '작업 체크리스트',
    file: 'TASKS.md',
    audience: 'ai',
    mime: 'text/markdown;charset=utf-8',
    hint: 'FR 의존성 순서대로 정렬된 체크리스트.',
    defaultOn: false,
    render: renderTasks,
  },
  {
    id: 'setup',
    label: '환경 세팅 지침',
    file: 'SETUP.md',
    audience: 'ai',
    mime: 'text/markdown;charset=utf-8',
    hint: '문서 배치 · 서브에이전트 · 권한 allowlist 후보.',
    defaultOn: false,
    render: (state, issues) => `${renderSetupGuide(state)}\n\n${renderUndecided(state, issues)}\n`,
  },
];

export const byId = (id: ArtifactId): ArtifactDef => {
  const found = ARTIFACTS.find((a) => a.id === id);
  if (!found) throw new Error(`알 수 없는 산출물: ${id}`);
  return found;
};

export const DEFAULT_SELECTION: readonly ArtifactId[] =
  ARTIFACTS.filter((a) => a.defaultOn).map((a) => a.id);

/** 개별 파일명에는 프로젝트명을 붙인다. 다운로드 폴더에서 섞이지 않게. */
export function fileNameFor(state: PRDState, def: ArtifactDef): string {
  return `${slug(state.projectName)}-${def.file}`;
}

export function renderOne(
  state: PRDState, issues: readonly ValidationIssue[], id: ArtifactId,
): { name: string; text: string; mime: string } {
  const def = byId(id);
  return { name: fileNameFor(state, def), text: def.render(state, issues), mime: def.mime };
}

/** 고른 것만 압축한다 — §B4 AC1. 압축 파일 안에서는 표준 파일명을 쓴다. */
export function makeBundle(
  state: PRDState, issues: readonly ValidationIssue[], ids: readonly ArtifactId[],
): Uint8Array {
  const chosen = ARTIFACTS.filter((a) => ids.includes(a.id));
  return makeZip(chosen.map((a) => ({ name: a.file, text: a.render(state, issues) })));
}

export function downloadOne(
  state: PRDState, issues: readonly ValidationIssue[], id: ArtifactId,
): void {
  const { name, text, mime } = renderOne(state, issues, id);
  downloadText(name, text, mime);
}

export function downloadBundle(
  state: PRDState, issues: readonly ValidationIssue[], ids: readonly ArtifactId[],
): void {
  const zip = makeBundle(state, issues, ids);
  const url = URL.createObjectURL(new Blob([zip as BlobPart], { type: 'application/zip' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `${slug(state.projectName)}-v${state.version}.zip`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
