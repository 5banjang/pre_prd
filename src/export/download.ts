// 파일 저장 유틸 — ExportBar · 보관함 · 판본 다시받기가 같은 경로를 쓴다.
//
// 여기저기 흩어져 있던 Blob 생성/해제 코드를 한 곳으로 모은 것이다.
// 특히 revoke 타이밍은 한 번만 정해두지 않으면 다시 틀리기 쉽다.

/** 파일명에 쓸 수 있게 다듬는다. 한글은 살린다 — `\p{L}`에 포함된다. */
export function slug(name: string): string {
  return (name.trim() || 'prd').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '').slice(0, 40);
}

/**
 * 텍스트를 파일로 내려준다.
 *
 * 즉시 `revokeObjectURL`을 부르면 일부 브라우저가 저장을 취소한다. 1초 뒤에 푼다.
 */
export function downloadText(
  filename: string, text: string, mime = 'text/markdown;charset=utf-8',
): void {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
