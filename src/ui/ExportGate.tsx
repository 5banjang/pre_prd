// 내보내기 전 점검 화면 — FR-005 개정 (개정안 #02 §B3).
//
// 이 화면은 **막지 않는다.** 무엇이 비었는지 보여주고 사용자가 정하게 한다.
//  · [지금 작성] — 해당 섹션으로 보낸다. 채우면 목록에서 사라진다.
//  · [건너뛰기]  — 확인했다는 표시. 산출물에는 '미정'으로 남는다.
//  · [모두 건너뛰고 내보내기] — 하나도 안 채워도 문서가 나온다.

import { useRef, useState } from 'react';
import { SECTION_DEFS, type PRDState, type SectionId } from '../types/prd.js';
import { explain, plainExcerpt } from '../validator/explain.js';
import type { ValidationIssue } from '../validator/validate.js';
import { ExportBar } from './ExportBar.js';

interface Props {
  state: PRDState;
  issues: readonly ValidationIssue[];
  /** [직접 쓰기] — 해당 섹션을 펼치고 스크롤한다. 모달은 닫힌다. */
  onJump: (id: SectionId) => void;
  /** [미검증] 붙여주기 — 앱이 대신 표시를 넣는다. 없으면 버튼이 안 나온다. */
  onTagUnverified?: (issue: ValidationIssue) => void;
  /**
   * 산출물을 처음 받아간 순간 한 번만 불린다 — 지금 판본을 스냅샷으로 굳히고
   * 작업본의 버전을 올린다 (§B2 AC3).
   *
   * 3종을 연달아 받아도 그것은 **같은 판본**이므로 한 번만 찍는다.
   */
  onExported: () => void;
  onClose: () => void;
}

/** 같은 규칙이 섹션마다 걸릴 수 있으므로 코드만으로는 키가 겹친다. */
function keyOf(i: ValidationIssue): string {
  return `${i.code}:${i.sectionId ?? '-'}`;
}

export function ExportGate({ state, issues, onJump, onTagUnverified, onExported, onClose }: Props) {
  const [phase, setPhase] = useState<'check' | 'download'>('check');
  const [skipped, setSkipped] = useState<ReadonlySet<string>>(new Set());
  // 이 게이트를 여는 동안 판본은 하나다. 파일을 몇 개 받든 한 번만 찍는다.
  const stamped = useRef(false);

  function take() {
    if (stamped.current) return;
    stamped.current = true;
    onExported();
  }

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
                ? '빠진 항목 없음'
                : `채울 곳 ${pending.length}${held.length > 0 ? ` · 건너뜀 ${held.length}` : ''}`}
            </span>
          )}
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>

        {phase === 'check' ? (
          <div className="gate-body">
            {pending.length === 0 ? (
              <div className="gate-pass">
                <p><strong>✓ 필요한 곳은 다 채우셨습니다.</strong></p>
                {warnings.length > 0 && (
                  <p className="hint">
                    한 번 봐두면 좋을 곳이 {warnings.length}군데 있지만, 문서 받는 데는 지장 없습니다.
                  </p>
                )}
              </div>
            ) : (
              <>
                <p className="gate-lead">
                  여기만 아직 안 채워졌어요. <strong>지금 채우셔도 되고, 그냥 넘어가셔도 문서는 나옵니다.</strong>
                  <br />
                  <span className="hint">넘어간 항목은 문서 맨 위에 <strong>미정</strong>이라고 적어둡니다.
                  개발 AI가 그 자리를 마음대로 채우지 않게 하려는 표시입니다.</span>
                </p>

                <ul className="gate-list">
                  {open.map((i) => {
                    const e = explain(i.code);
                    return (
                      <li key={keyOf(i)}>
                        <div className="gate-item">
                          <span className="sid">
                            {i.sectionId ? SECTION_DEFS[i.sectionId].label : '문서 전체'}
                          </span>
                          <span className="text">
                            {i.message}
                            {/* 원문은 기호를 걷어내고 한 줄로 — 마크다운을 그대로 박으면 못 읽는다 */}
                            {i.evidence && (
                              <span className="evidence">“{plainExcerpt(i.evidence)}”</span>
                            )}
                            {/* 판단 근거 — 비면 무엇이 잘못되는가. 이게 없으면 다 건너뛴다. */}
                            <span className="why">{e.why}</span>
                          </span>
                          <code className="code" title={`검증 규칙 코드: ${i.code}`}>?</code>
                        </div>
                        <div className="gate-actions">
                          {/* 표시 하나 붙이는 일은 앱이 대신 한다. 손으로 고치라 하면 다 건너뛴다. */}
                          {i.sectionId && i.evidence && onTagUnverified && (
                            <button onClick={() => onTagUnverified(i)}>
                              [미검증] 붙여주기
                            </button>
                          )}
                          {i.sectionId && (
                            <button className={i.evidence ? 'ghost' : ''} onClick={() => writeNow(i)}>
                              직접 쓰기
                            </button>
                          )}
                          <button className="ghost" onClick={() => skip(i)}>나중에</button>
                        </div>
                      </li>
                    );
                  })}
                </ul>

                {held.length > 0 && (
                  <details className="gate-held" open>
                    <summary>나중에 하기로 한 {held.length}건 — 문서에 '미정'으로 적어둡니다</summary>
                    <ul className="gate-list held">
                      {held.map((i) => (
                        <li key={keyOf(i)}>
                          <div className="gate-item">
                            <span className="sid">
                              {i.sectionId ? SECTION_DEFS[i.sectionId].label : '문서 전체'}
                            </span>
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
            <ExportBar state={state} issues={issues} onTake={take} />
          </div>
        )}

        {phase === 'check' && (
          <div className="gate-foot">
            <span className="hint">
              {open.length > 0
                ? `${open.length}군데를 비운 채 내보냅니다.`
                : '비운 곳이 없습니다.'}
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
