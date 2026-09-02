// 자료 첨부 줄 — FR-015.
//
// 입력칸 위에 붙는다. 파일을 고르면 **업로드 전에** 형식·크기를 검사하고,
// 통과한 것만 읽기로 넘긴다. 거부 문구에는 한도를 숫자로 넣는다 (§B1 AC5).
//
// 입력칸에 쓰던 글은 "이 자료를 어디에 쓰라"는 메모로 함께 넘어간다.

import { useRef } from 'react';
import type { PRDState } from '../types/prd.js';
import { ACCEPT_ATTR, MAX_ATTACHMENT_MB, classifyFile } from '../engine/attachment.js';
import type { ExtractInput } from '../engine/extract.js';

interface Props {
  state: PRDState;
  /** 읽는 중인 파일명. null이면 대기 상태다. */
  reading: string | null;
  /** 형식·크기 거부 문구. 사용자가 고칠 수 있는 내용이므로 그대로 보여준다. */
  refusal: string | null;
  disabled: boolean;
  onPick: (input: ExtractInput) => void;
  onRefuse: (message: string | null) => void;
}

export function AttachBar(p: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const count = p.state.attachments.length;

  function choose(file: File | undefined) {
    if (!file) return;
    const check = classifyFile(file);
    if (!check.ok) {
      p.onRefuse(check.message);
      return;
    }
    p.onRefuse(null);
    p.onPick({
      kind: check.kind,
      mimeType: check.mimeType,
      name: file.name,
      bytes: file.size,
      file,
    });
  }

  return (
    <div className="attach">
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT_ATTR}
        hidden
        onChange={(e) => {
          choose(e.target.files?.[0]);
          e.target.value = '';      // 같은 파일을 다시 골라도 이벤트가 오게 비운다
        }}
      />

      <button
        type="button"
        className="ghost attach-btn"
        disabled={p.disabled || p.reading !== null}
        onClick={() => inputRef.current?.click()}
      >
        {p.reading ? `${p.reading} 읽는 중…` : '자료 첨부'}
      </button>

      {p.reading
        ? <span className="hint">한 번만 읽고 원본은 버립니다. 길이에 따라 1분 넘게 걸릴 수 있습니다.</span>
        : (
          <span className="hint">
            문서·녹음 {MAX_ATTACHMENT_MB}MB까지. 한 번 읽어 항목에 반영하고 원본은 버립니다.
            {count > 0 && <> 지금까지 <b>{count}건</b> 읽었습니다.</>}
          </span>
        )}

      {p.refusal && (
        <p className="attach-refusal">
          {p.refusal}
          <button className="link" onClick={() => p.onRefuse(null)}>닫기</button>
        </p>
      )}
    </div>
  );
}
