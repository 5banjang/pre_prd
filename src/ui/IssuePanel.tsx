// 완성도 패널 — FR-005 개정 (개정안 #02 §A).
//
// 더 이상 내보내기를 막지 않는다. 진행률과 남은 항목을 보여주고,
// 항목을 누르면 해당 섹션으로 데려간다. 실제 내보내기는 점검 화면(ExportGate)이 맡는다.

import { SECTION_DEFS, type PRDState, type SectionId } from '../types/prd.js';
import { explain } from '../validator/explain.js';
import type { Completeness, ValidationIssue } from '../validator/validate.js';

/**
 * 한 줄 표시 — 개정안 #02 §B3 AC2.
 *
 * `S7`·`MISSING_SECTION` 같은 내부 코드를 앞세우지 않는다. 사용자는 그게 뭔지 알 필요가 없다.
 * 섹션 한글 이름을 누를 수 있는 칩으로 두고, 규칙 코드는 툴팁으로 내린다.
 */
function IssueRow({ issue, onJump }: { issue: ValidationIssue; onJump: (id: SectionId) => void }) {
  const e = explain(issue.code);
  return (
    <>
      {issue.sectionId
        ? (
          <button
            className="sid link"
            onClick={() => onJump(issue.sectionId!)}
            title={`'${SECTION_DEFS[issue.sectionId].label}'로 이동`}
          >
            {SECTION_DEFS[issue.sectionId].label}
          </button>
        )
        : <span className="sid" title="특정 항목이 아니라 문서 전체에 걸린 문제입니다">문서 전체</span>}
      <span className="text" title={`${e.what} ${e.why}`}>{issue.message}</span>
      <code className="code" title={`검증 규칙 코드: ${issue.code}`}>?</code>
    </>
  );
}

interface Props {
  issues: readonly ValidationIssue[];
  completeness: Completeness;
  state: PRDState;
  onJump: (id: SectionId) => void;
  onOpenGate: () => void;
}

export function IssuePanel({ issues, completeness, state, onJump, onOpenGate }: Props) {
  const pending = issues.filter((i) => i.severity === 'incomplete');
  const warnings = issues.filter((i) => i.severity === 'warn');
  const done = pending.length === 0;
  // "모르겠어요"로 넘긴 것 — 내가 정한 게 아니라 엔진이 정한 값이다. 세어서 보여준다.
  const assumed = state.assumptions.filter((a) => a.source !== 'user').length;

  return (
    <section className="issues">
      <div className={`issues-head ${done ? 'pass' : 'partial'}`}>
        <div className="progress" role="img" aria-label={`완성도 ${completeness.percent}%`}>
          <div className="progress-fill" style={{ width: `${completeness.percent}%` }} />
        </div>
        <strong>완성도 {completeness.percent}%</strong>
        <span className="dim">
          {done ? '빠진 항목 없음' : `채울 곳 ${pending.length}`}
          {warnings.length > 0 && ` · 살펴볼 곳 ${warnings.length}`}
        </span>
      </div>

      <ul className="issue-list">
        {pending.map((i, n) => (
          <li key={`p${n}`} className="pending"><IssueRow issue={i} onJump={onJump} /></li>
        ))}
        {warnings.map((i, n) => (
          <li key={`w${n}`} className="warn"><IssueRow issue={i} onJump={onJump} /></li>
        ))}
      </ul>

      <div className="issues-foot">
        {assumed > 0 && (
          <p className="assumed-note">
            <button className="sid link" onClick={() => onJump('S10')}>
              엔진이 대신 정한 값 {assumed}개
            </button>
            <span> — 내가 고른 게 아닙니다. 문서에 가정으로 실리니 한 번 훑어보세요.</span>
          </p>
        )}
        <button className="primary wide" onClick={onOpenGate}>문서 뽑기</button>
        <p className="hint">
          {done
            ? '필수 항목을 전부 채웠습니다.'
            : '다 채우지 않아도 문서는 나옵니다. 안 채운 곳은 문서에 미정으로 남습니다.'}
        </p>
      </div>
    </section>
  );
}
