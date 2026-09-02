import { describe, it, expect } from 'vitest';
import { crc32, makeZip } from './zip.js';

const enc = new TextEncoder();
const u32 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(at, true);
const u16 = (b: Uint8Array, at: number) => new DataView(b.buffer, b.byteOffset, b.byteLength).getUint16(at, true);

describe('crc32', () => {
  // 표준 시험값. 여기가 틀리면 압축 파일이 "손상됨"으로 열린다.
  it('알려진 시험값과 일치한다', () => {
    expect(crc32(enc.encode('hello')).toString(16)).toBe('3610a686');
    expect(crc32(enc.encode('')).toString(16)).toBe('0');
    expect(crc32(enc.encode('123456789')).toString(16)).toBe('cbf43926');
  });
});

describe('makeZip', () => {
  const zip = makeZip([
    { name: 'PRD.md', text: '# 제목\n본문' },
    { name: 'docs/prd.json', text: '{"a":1}' },
  ], new Date('2026-09-02T10:20:30'));

  it('local · central · EOCD 서명이 순서대로 있다', () => {
    expect(u32(zip, 0)).toBe(0x04034b50);
    expect(u32(zip, zip.length - 22)).toBe(0x06054b50);
    // 중앙 디렉터리 위치가 EOCD에 적힌 값과 맞는다
    const cdOffset = u32(zip, zip.length - 22 + 16);
    expect(u32(zip, cdOffset)).toBe(0x02014b50);
  });

  it('항목 수가 EOCD에 반영된다', () => {
    expect(u16(zip, zip.length - 22 + 8)).toBe(2);
    expect(u16(zip, zip.length - 22 + 10)).toBe(2);
  });

  it('무압축이라 원본 바이트가 그대로 들어간다', () => {
    const text = new TextDecoder().decode(zip);
    expect(text).toContain('# 제목\n본문');
    expect(text).toContain('{"a":1}');
    expect(text).toContain('docs/prd.json');
  });

  it('한글 파일명을 위해 UTF-8 플래그(bit 11)를 세운다', () => {
    const z = makeZip([{ name: '한글-PRD.md', text: 'x' }]);
    expect(u16(z, 6) & 0x0800).toBe(0x0800);
    expect(new TextDecoder().decode(z)).toContain('한글-PRD.md');
  });

  it('압축 크기와 원본 크기가 같고 CRC가 본문과 맞는다', () => {
    const body = '내용';
    const z = makeZip([{ name: 'a.txt', text: body }]);
    const bytes = enc.encode(body);
    expect(u32(z, 14)).toBe(crc32(bytes));
    expect(u32(z, 18)).toBe(bytes.length);
    expect(u32(z, 22)).toBe(bytes.length);
  });

  it('빈 목록도 유효한 빈 압축 파일이 된다', () => {
    const z = makeZip([]);
    expect(z.length).toBe(22);
    expect(u32(z, 0)).toBe(0x06054b50);
  });
});
