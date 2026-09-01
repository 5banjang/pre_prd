// 내보내기 전 점검 화면 — FR-005 개정 (개정안 #02 §B3).
//
// 이 화면은 **막지 않는다.** 무엇이 비었는지 보여주고 사용자가 정하게 한다.
//  · [지금 작성] — 해당 섹션으로 보낸다. 채우면 목록에서 사라진다.
//  · [건너뛰기]  — 확인했다는 표시. 산출물에는 '미정'으로 남는다.
//  · [모두 건너뛰고 내보내기] — 하나도 안 채워도 문서가 나온다.

import { useState } from 'react';
import type { PRDState, SectionId } from '../types/prd.js';
import type { ValidationIssue } from '../validator/validate.js';
import { ExportBar } from './ExportBar.js';

interface Props {
  state: PRDState;
  issues: readonly ValidationIssue[];
  /** [지금 작성] — 해당 섹션을 펼치고 스크롤한다. 모달은 닫힌다. */
  onJump: (id: SectionId) => void;
  onClose: () => void;
}

/** 같은 규칙이 섹션마다 걸릴 수 있으므로 코드만으로는 키가 겹친다. */
function keyOf(i: ValidationIssue): string {
  return `${i.code}:${i.sectionId ?? '-'}`;
}

export function ExportGate({ state, issues, onJump, onClose }: Props) {
  const [phase, setPhase] = useState<'check' | 'download'>('check');
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());

  const pending = issues.filter((i) => i.severity === 'incomplete');
  const warnings = issues.filter((i) => i.severity === 'warn');

  const open = pending.filter((i) => !skipped.has(keyOf(i)));
  const held = pending.filter((i) => skipped.has(keyOf(i)));

  function skip(i: ValidationIssue) {
    setSkipped((prev) => new Set(prev).add(keyOf(i)));
  }

  function unskip(i: ValidationIssue) {
    setSkipped((prev) => {
      const next = new Set(prev);
      next.delete(keyOf(i));
      return next;
    });
  }

  function writeNow(i: ValidationIssue) {
    if (i.sectionId) onJump(i.sectionId);
    onClose();
  }

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box gate" onClick={(e) => e.stopPropagation()}>

        <div className="modal-head">
          <strong>{phase === 'check' ? '내보내기 전 점검' : '문서 받기'}</strong>
          {phase === 'check' && (
            <span className="dim">
              {pending.length === 0
                ? '전 항목 통과'
                : `미완성 ${pending.length}건${held.length > 0 ? ` · 건너뜀 ${held.length}` : ''}`}
            </span>
          )}
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>

        {phase === 'check' ? (
          <div className="gate-body">
            {pending.length === 0 ? (
              <div className="gate-pass">
                <p><strong>✓ 완성 기준을 전부 충족했습니다.</strong></p>
                {warnings.length > 0 && (
                  <p className="hint">
                    경고 {warnings.length}건이 있지만 내보내기에는 영향이 없습니다.
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="gate-lead">
                  아래 항목이 아직 비어 있습니다. 지금 채우거나, 건너뛰고 문서를 받으세요.
                  <br />
                  <span className="hint">건너뛴 항목은 문서 맨 위에 <strong>미정</strong>으로 표시되어
                  개발 AI가 임의로 채우지 않습니다.</span>
                </p>

                <ul className="gate-list">
                  {open.map((i) => (
                    <li key={keyOf(i)}>
                      <div className="gate-item">
                        <span className="sid">{i.sectionId ?? '전역'}</span>
                        <span className="text">{i.message}</span>
                        <code className="code">{i.code}</code>
                      </div>
                      <div className="gate-actions">
                        {i.sectionId && (
                          <button onClick={() => writeNow(i)}>지금 작성</button>
                        )}
                        <button className="ghost" onClick={() => skip(i)}>건너뛰기</button>
                      </div>
                    </li>
                  ))}
                </ul>

                {held.length > 0 && (
                  <details className="gate-held" open>
                    <summary>건너뛴 항목 {held.length}건 — 문서에 미정으로 남습니다</summary>
                    <ul className="gate-list held">
                      {held.map((i) => (
                        <li key={keyOf(i)}>
                          <div className="gate-item">
                            <span className="sid">{i.sectionId ?? '전역'}</span>
                            <span className="text">{i.message}</span>
                          </div>
                          <div className="gate-actions">
                            <button className="ghost" onClick={() => unskip(i)}>되돌리기</button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </>
            )}
          </div>
        ) : (
          <div className="gate-body">
            <ExportBar state={state} issues={issues} />
          </div>
        )}

        {phase === 'check' && (
          <div className="gate-foot">
            <span className="hint">
              {open.length > 0
                ? `${open.length}건을 남긴 채 내보냅니다.`
                : '남은 항목이 없습니다.'}
            </span>
            <button className="primary" onClick={() => setPhase('download')}>
              {open.length > 0 ? '모두 건너뛰고 내보내기' : '문서 받기'}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
