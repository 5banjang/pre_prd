// 자료 첨부 — 개정안 #02 §B1 (FR-015).
//
// 첨부는 **한 번만 읽고 버린다.** 원본 바이트는 상태에도 저장소에도 남지 않는다.
// 컨텍스트에 남기면 매 턴 재전송돼 비용이 턴 수에 비례해 폭증하기 때문이다
// (1시간 녹음을 30턴 끌고 다니면 $0.086이 아니라 $2.6).
//
// 여기는 **파일을 받기 전 검사**와 전송용 인코딩만 담당한다. 호출은 extract.ts가 한다.

import type { AttachmentKind } from '../types/prd.js';

/**
 * 요청 하나에 실을 수 있는 원본 크기 상한.
 *
 * 공식 문서 확인(2026-09-02, ai.google.dev/gemini-api/docs/audio):
 * "Maximum request size is 20 MB total (including prompts and all files)".
 * base64는 원본의 약 1.34배로 부풀고 프롬프트도 함께 실리므로 12MB로 잡는다.
 * 이보다 큰 파일은 Files API가 필요한데, 브라우저에서의 CORS를 확인하지 못해 쓰지 않는다.
 */
export const MAX_ATTACHMENT_BYTES = 12 * 1024 * 1024;

/** 화면에 숫자로 보여줄 한도 — AC5는 "한도를 숫자로" 알리라고 요구한다. */
export const MAX_ATTACHMENT_MB = MAX_ATTACHMENT_BYTES / (1024 * 1024);

/**
 * 문서 형식. 공식 문서 기준 문서 이해는 **PDF만 제대로 본다** — 나머지는 글자만 읽힌다.
 * 그래서 표·그림이 중요한 자료는 PDF로 넣으라고 안내한다.
 */
const DOCUMENT_TYPES: Record<string, string> = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  html: 'text/html',
};

/** 오디오 형식 — 공식 문서 확인(2026-09-02, ai.google.dev/gemini-api/docs/audio). */
const AUDIO_TYPES: Record<string, string> = {
  mp3: 'audio/mp3',
  mpeg: 'audio/mpeg',
  wav: 'audio/wav',
  m4a: 'audio/m4a',
  aac: 'audio/aac',
  ogg: 'audio/ogg',
  opus: 'audio/opus',
  flac: 'audio/flac',
  aiff: 'audio/aiff',
  webm: 'audio/webm',
};

/** 파일 선택 창에 넘길 필터. 목록은 위 두 표에서 만든다 — 한 곳만 고치면 된다. */
export const ACCEPT_ATTR = [
  ...Object.keys(DOCUMENT_TYPES).map((e) => `.${e}`),
  ...Object.keys(AUDIO_TYPES).map((e) => `.${e}`),
].join(',');

/** 검사에 필요한 것만. 테스트가 진짜 File을 만들지 않아도 되게 최소 모양으로 받는다. */
export interface FileLike {
  name: string;
  size: number;
  /** 브라우저가 비워 보내는 경우가 있어(특히 .md) 확장자를 우선한다. */
  type?: string;
}

export type Accepted = { ok: true; kind: AttachmentKind; mimeType: string };
export type Rejected = { ok: false; message: string };

const extOf = (name: string) => name.slice(name.lastIndexOf('.') + 1).toLowerCase();

function mb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * 받을 수 있는 파일인지 **업로드 전에** 판정한다 — AC5.
 *
 * 거부 문구에는 한도를 숫자로 넣는다. "지원하지 않습니다"만 뜨면 사용자는 뭘 고쳐야 할지 모른다.
 */
export function classifyFile(file: FileLike): Accepted | Rejected {
  const ext = extOf(file.name);
  const mimeType = DOCUMENT_TYPES[ext] ?? AUDIO_TYPES[ext];

  if (!mimeType) {
    return {
      ok: false,
      message: `'${ext || file.name}'은 읽을 수 없는 형식입니다.`
        + ` 문서(${Object.keys(DOCUMENT_TYPES).join('·')})나`
        + ` 녹음(${Object.keys(AUDIO_TYPES).slice(0, 5).join('·')} 등)으로 넣어주세요.`,
    };
  }

  if (file.size <= 0) {
    return { ok: false, message: '내용이 없는 파일입니다.' };
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return {
      ok: false,
      message: `파일이 ${mb(file.size)}로 한도(${MAX_ATTACHMENT_MB}MB)를 넘습니다.`
        + ' 필요한 부분만 잘라서 넣거나, 녹음이면 나눠서 올려주세요.',
    };
  }

  return { ok: true, kind: ext in AUDIO_TYPES ? 'audio' : 'document', mimeType };
}

/** 오디오 토큰 추정 — 공식 문서: 초당 32토큰. 길이를 모르면 null. */
export function estimateAudioTokens(seconds: number | null): number | null {
  return seconds === null ? null : Math.round(seconds * 32);
}

/** 바이트 → base64. 큰 파일에서 스택이 터지지 않게 조각내 돌린다. */
export function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000;
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

/** 전송 직전에 한 번 만든다. 만든 문자열은 호출이 끝나면 버린다. */
export async function toBase64(file: Blob): Promise<string> {
  return bytesToBase64(new Uint8Array(await file.arrayBuffer()));
}
