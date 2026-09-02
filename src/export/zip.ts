// 최소 ZIP 작성기 — 개정안 #02 §B4 AC1 "[전체 받기] 한 번에 zip 하나로".
//
// 라이브러리를 넣지 않은 이유: 산출물은 텍스트 7개뿐이라 **압축이 무의미**하다.
// 무압축(store) ZIP은 헤더 세 종류면 끝나고, 그러면 브라우저 번들에 아무것도 안 는다.
// 이 프로젝트는 런타임 의존성이 3개다. 이걸 위해 네 번째를 들이지 않는다.
//
// 규격: APPNOTE.TXT 4.3 — Local file header / Central directory / EOCD.
// ZIP64는 쓰지 않는다. 4GB를 넘길 산출물이 아니다.

export interface ZipEntry {
  /** 압축 파일 안의 경로. `/`로 폴더를 만든다. */
  name: string;
  text: string;
}

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i += 1) {
    let c = i;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = CRC_TABLE[(c ^ bytes[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** MS-DOS 시각 형식. 2초 단위이고 1980년이 기준점이다. */
function dosStamp(d: Date): { time: number; date: number } {
  return {
    time: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1),
    date: ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate(),
  };
}

/** 크기를 미리 못 세므로 조각을 모았다가 마지막에 잇는다. */
function concat(chunks: readonly Uint8Array[]): Uint8Array {
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.length; }
  return out;
}

/**
 * 무압축 ZIP을 만든다.
 *
 * 파일명에 UTF-8을 쓰므로 general purpose flag의 bit 11을 세운다.
 * 이걸 빼면 한글 파일명이 윈도우에서 깨진다.
 */
export function makeZip(entries: readonly ZipEntry[], now = new Date()): Uint8Array {
  const enc = new TextEncoder();
  const { time, date } = dosStamp(now);

  const locals: Uint8Array[] = [];
  const centrals: Uint8Array[] = [];
  let offset = 0;

  for (const e of entries) {
    const name = enc.encode(e.name);
    const data = enc.encode(e.text);
    const crc = crc32(data);

    const local = new Uint8Array(30 + name.length);
    const lv = new DataView(local.buffer);
    lv.setUint32(0, 0x04034b50, true);   // 서명
    lv.setUint16(4, 20, true);           // 필요 버전 2.0
    lv.setUint16(6, 0x0800, true);       // bit 11 — 파일명이 UTF-8이다
    lv.setUint16(8, 0, true);            // 압축 방식 0 = store
    lv.setUint16(10, time, true);
    lv.setUint16(12, date, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, data.length, true); // 무압축이라 압축 크기 = 원본 크기
    lv.setUint32(22, data.length, true);
    lv.setUint16(26, name.length, true);
    lv.setUint16(28, 0, true);           // extra 없음
    local.set(name, 30);

    const central = new Uint8Array(46 + name.length);
    const cv = new DataView(central.buffer);
    cv.setUint32(0, 0x02014b50, true);
    cv.setUint16(4, 20, true);           // 작성 버전
    cv.setUint16(6, 20, true);           // 필요 버전
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, time, true);
    cv.setUint16(14, date, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, data.length, true);
    cv.setUint32(24, data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint16(30, 0, true);           // extra
    cv.setUint16(32, 0, true);           // comment
    cv.setUint16(34, 0, true);           // 시작 디스크
    cv.setUint16(36, 0, true);           // 내부 속성
    cv.setUint32(38, 0, true);           // 외부 속성
    cv.setUint32(42, offset, true);      // local header 위치
    central.set(name, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const cdBytes = concat(centrals);
  const eocd = new Uint8Array(22);
  const ev = new DataView(eocd.buffer);
  ev.setUint32(0, 0x06054b50, true);
  ev.setUint16(4, 0, true);                    // 이 디스크 번호
  ev.setUint16(6, 0, true);                    // 중앙 디렉터리 시작 디스크
  ev.setUint16(8, entries.length, true);
  ev.setUint16(10, entries.length, true);
  ev.setUint32(12, cdBytes.length, true);
  ev.setUint32(16, offset, true);              // 중앙 디렉터리 위치
  ev.setUint16(20, 0, true);                   // 주석 없음

  return concat([...locals, cdBytes, eocd]);
}
