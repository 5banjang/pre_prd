// 문서 보관함 — FR-016 (개정안 #02 §B2).
//
// 이전에는 문서가 하나뿐이라 새 프로젝트를 시작하면 이전 것을 말없이 덮어썼다.
// 여기서 여러 문서를 만들고, 열고, 보완해서 새 버전을 다시 뽑는다.

import { useEffect, useRef, useState } from 'react';
import type { DocumentSummary, Snapshot } from '../storage/library.js';

interface Props {
  docs: readonly DocumentSummary[];
  currentId: string | null;
  busy: boolean;
  onOpen: (id: string) => void;
  onCreate: () => void;
  onDuplicate: (id: string) => void;
  onDelete: (id: string) => void;
  onExportBackup: () => void;
  onImportBackup: (file: File) => void;
  /** 이미 읽어둔 판본 목록. 없는 문서는 펼칠 때 읽는다. */
  snapshots: Readonly<Record<string, Snapshot[]>>;
  onLoadHistory: (id: string) => void;
  onDownloadSnapshot: (id: string, index: number) => void;
  onClose: () => void;
}

function when(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const mins = Math.floor((Date.now() - d.getTime()) / 60000);
  if (mins < 1) return '방금';
  if (mins < 60) return `${mins}분 전`;
  if (mins < 60 * 24) return `${Math.floor(mins / 60)}시간 전`;
  return d.toLocaleDateString();
}

export function LibraryPanel({
  docs, currentId, busy,
  onOpen, onCreate, onDuplicate, onDelete, onExportBackup, onImportBackup,
  snapshots, onLoadHistory, onDownloadSnapshot, onClose,
}: Props) {
  // 삭제는 되돌릴 수 없다 — 확인을 받는다 (개정안 #02 §B2 AC2).
  const [confirming, setConfirming] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-box library" onClick={(e) => e.stopPropagation()}>

        <div className="modal-head">
          <strong>문서 보관함</strong>
          <span className="dim">{docs.length}개</span>
          <button className="ghost" onClick={onClose}>닫기</button>
        </div>

        <div className="lib-body">
          {docs.length === 0 ? (
            <p className="lib-empty">아직 문서가 없습니다. 새 문서를 만들어 시작하세요.</p>
          ) : (
            <ul className="lib-list">
              {docs.map((d) => (
                <li key={d.id} className={d.id === currentId ? 'current' : undefined}>
                  <button
                    className="lib-open"
                    disabled={busy}
                    onClick={() => onOpen(d.id)}
                    title={d.id === currentId ? '지금 열려 있는 문서입니다' : '이 문서를 엽니다'}
                  >
                    <span className="lib-name">
                      {d.projectName || '(제목 미정)'}
                      {d.id === currentId && <span className="lib-badge">열림</span>}
                    </span>
                    <span className="lib-meta">
                      v{d.version} · 턴 {d.turn} ·{' '}
                      <span className={d.incompleteCount === 0 ? 'ok' : 'draft'}>
                        {d.incompleteCount === 0 ? '전 항목 통과' : `미완성 ${d.incompleteCount}`}
                      </span>
                      {' · '}{when(d.updatedAt)}
                    </span>
                  </button>

                  <div className="lib-actions">
                    {confirming === d.id ? (
                      <>
                        <button className="danger" onClick={() => { onDelete(d.id); setConfirming(null); }}>
                          정말 삭제
                        </button>
                        <button className="ghost" onClick={() => setConfirming(null)}>취소</button>
                      </>
                    ) : (
                      <>
                        <button className="ghost" disabled={busy} onClick={() => onDuplicate(d.id)}>복제</button>
                        <button className="ghost" onClick={() => setConfirming(d.id)}>삭제</button>
                      </>
                    )}
                  </div>

                  {d.snapshotCount > 0 && (
                    <details
                      className="lib-history"
                      onToggle={(e) => { if (e.currentTarget.open) onLoadHistory(d.id); }}
                    >
                      <summary>내보낸 판본 {d.snapshotCount}개</summary>
                      {snapshots[d.id] === undefined ? (
                        <p className="hint">읽는 중…</p>
                      ) : (
                        <ul className="lib-versions">
                          {/* 최신이 위로 오게 뒤집는다 */}
                          {snapshots[d.id]!.map((snap, i) => ({ snap, i })).reverse().map(({ snap, i }) => (
                            <li key={`${snap.version}-${snap.at}-${i}`}>
                              <span className="lib-ver">v{snap.version}</span>
                              <span className="dim">{when(snap.at)}</span>
                              <button className="ghost" onClick={() => onDownloadSnapshot(d.id, i)}>
                                ⭳ 이 판본 받기
                              </button>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="hint">
                        개발 AI에게 넘긴 판본은 지우지 않습니다. 최근 10개까지 보관됩니다.
                      </p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="lib-foot">
          <button className="primary" disabled={busy} onClick={onCreate}>+ 새 문서</button>
          <span className="spacer" />
          <button className="ghost" onClick={onExportBackup}>⭳ 전체 백업</button>
          <button className="ghost" onClick={() => fileInput.current?.click()}>⭱ 백업 가져오기</button>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onImportBackup(f);
              e.target.value = '';
            }}
          />
        </div>

        <p className="hint">
          모든 문서는 이 브라우저에만 저장됩니다. 기기를 옮기려면 전체 백업을 내보내세요.
        </p>

      </div>
    </div>
  );
}
