// 검증 이슈 패널 — FR-005.
// 차단 이슈가 1개라도 있으면 내보내기 버튼이 비활성화된다 (AC1).
// 각 이슈는 해당 섹션명과 함께 표시된다 (AC2).

import type { PRDState } from '../types/prd.js';
import type { ValidationIssue } from '../validator/validate.js';
import { ExportBar } from './ExportBar.js';

interface Props {
  issues: readonly ValidationIssue[];
  canExport: boolean;
  state: PRDState;
}

export function IssuePanel({ issues, canExport, state }: Props) {
  const blocking = issues.filter((i) => i.severity === 'block');
  const warnings = issues.filter((i) => i.severity === 'warn');

  return (
    <section className="issues">
      <div className={`issues-head ${canExport ? 'pass' : 'blocked'}`}>
        {canExport
          ? <><strong>✓ 내보내기 가능</strong>{warnings.length > 0 && ` · 경고 ${warnings.length}`}</>
          : <strong>⚠ 내보내기 차단 ({blocking.length})</strong>}
      </div>

      <ul className="issue-list">
        {blocking.map((i, n) => (
          <li key={`b${n}`} className="block">
            {i.sectionId && <span className="sid">{i.sectionId}</span>}
            <span className="text">{i.message}</span>
            <code className="code">{i.code}</code>
          </li>
        ))}
        {warnings.map((i, n) => (
          <li key={`w${n}`} className="warn">
            {i.sectionId && <span className="sid">{i.sectionId}</span>}
            <span className="text">{i.message}</span>
            <code className="code">{i.code}</code>
          </li>
        ))}
      </ul>

      <ExportBar state={state} canExport={canExport} />
    </section>
  );
}
