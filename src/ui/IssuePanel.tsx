// 완성도 패널 — FR-005 개정 (개정안 #02 §A).
//
// 더 이상 내보내기를 막지 않는다. 진행률과 남은 항목을 보여주고,
// 항목을 누르면 해당 섹션으로 데려간다. 실제 내보내기는 점검 화면(ExportGate)이 맡는다.

import type { PRDState, SectionId } from '../types/prd.js';
import type { Completeness, ValidationIssue } from '../validator/validate.js';

interface Props {
  issues: readonly ValidationIssue[];
  completeness: Completeness;
  state: PRDState;
  onJump: (id: SectionId) => void;
  onOpenGate: () => void;
}

export function IssuePanel({ issues, completeness, onJump, onOpenGate }: Props) {
  const pending = issues.filter((i) => i.severity === 'incomplete');
  const warnings = issues.filter((i) => i.severity === 'warn');
  const done = pending.length === 0;

  return (
    <section className="issues">
      <div className={`issues-head ${done ? 'pass' : 'partial'}`}>
        <div className="progress" role="img" aria-label={`완성도 ${completeness.percent}%`}>
          <div className="progress-fill" style={{ width: `${completeness.percent}%` }} />
        </div>
        <strong>완성도 {completeness.percent}%</strong>
        <span className="dim">
          {done ? '전 항목 통과' : `미완성 ${pending.length}`}
          {warnings.length > 0 && ` · 경고 ${warnings.length}`}
        </span>
      </div>

      <ul className="issue-list">
        {pending.map((i, n) => (
          <li key={`p${n}`} className="pending">
            {i.sectionId
              ? <button className="sid link" onClick={() => onJump(i.sectionId!)}>{i.sectionId}</button>
              : <span className="sid">전역</span>}
            <span className="text">{i.message}</span>
            <code className="code">{i.code}</code>
          </li>
        ))}
        {warnings.map((i, n) => (
          <li key={`w${n}`} className="warn">
            {i.sectionId
              ? <button className="sid link" onClick={() => onJump(i.sectionId!)}>{i.sectionId}</button>
              : <span className="sid">전역</span>}
            <span className="text">{i.message}</span>
            <code className="code">{i.code}</code>
          </li>
        ))}
      </ul>

      <div className="issues-foot">
        <button className="primary wide" onClick={onOpenGate}>문서 뽑기</button>
        <p className="hint">
          {done
            ? '완성 기준을 전부 충족했습니다.'
            : '미완성이어도 내보낼 수 있습니다. 남은 항목은 문서에 미정으로 표시됩니다.'}
        </p>
      </div>
    </section>
  );
}
