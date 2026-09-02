// 벤더/제품 키워드 사전 — 스펙 §6.3.
//
// 목적은 완벽한 탐지가 아니라 "가격·모델명을 무심코 확정 서술하는 습관"의 차단이다.
// 사전은 완전할 필요 없다(스펙 §6.3). 오탐이 나면 줄인다 — §13 Q4.

/** 소문자 기준. 단어 경계로 매칭한다. */
export const VENDOR_KEYWORDS: readonly string[] = [
  // LLM 벤더·모델 계열
  'openai', 'gpt', 'chatgpt',
  'anthropic', 'claude', 'opus', 'sonnet', 'haiku',
  'google', 'gemini', 'vertex',
  'xai', 'grok',
  'meta', 'llama',
  'mistral', 'cohere', 'deepseek', 'qwen', 'kimi',
  // 인프라·서비스
  'vercel', 'netlify', 'supabase', 'firebase', 'cloudflare',
  'aws', 'bedrock', 'azure', 'hostinger',
  'stripe', 'elevenlabs', 'together', 'replicate',
];

/**
 * 버전 패턴. 스펙 §6.3이 제안한 /\b[a-z]+[-\s]?\d+(\.\d+)?\b/i 는 단독으로 쓰면
 * "FR-001", "S0", "React 18", "ES2022" 까지 전부 걸려 오탐이 심하다.
 * 그래서 **벤더 키워드와 인접한 경우에만** 버전으로 인정한다.
 * (예: "GPT-4", "Claude Opus 5", "Gemini 3.1" 은 잡고, "FR-001" 은 잡지 않는다.)
 */
const VERSION_SUFFIX = /^[-\s]?\d+(\.\d+)*/;

/** 오탐이 잦아 제외하는 토큰. 발견되는 대로 추가한다. */
const EXCLUDED = new Set(['meta', 'together', 'google']);

const ACTIVE_KEYWORDS = VENDOR_KEYWORDS.filter((k) => !EXCLUDED.has(k));

/** `[미검증]` 태그 또는 출처 URL이 있으면 그 문장은 통과시킨다. */
const TAG_RE = /\[미검증\]/;
const URL_RE = /https?:\/\/\S+/;

/**
 * 확정 서술 신호 — §13 Q4 오탐 대응.
 *
 * 스펙 §6.3의 목적은 "가격·모델명을 무심코 확정 서술하는 습관"의 차단이지
 * 벤더명 언급 자체의 금지가 아니다. 단순 언급까지 막으면 S8(기술 스택)에
 * 기술 이름을 쓸 수 없어 사용자가 영원히 내보내기를 못 한다.
 *
 * 그래서 **가격·수치·버전 같은 검증 대상 주장이 같은 문장에 있을 때만** 잡는다.
 * - "Vercel에 배포한다"          → 통과 (결정이지 주장이 아니다)
 * - "Vercel은 월 $20이다"        → 차단 (가격 주장)
 * - "GPT-4를 쓴다"               → 차단 (버전이 붙은 모델명)
 */
const CLAIM_RE =
  /[$₩]\s?[\d,]|\d[\d,.]*\s*(원|달러|만원|%|퍼센트|초|ms|토큰|tps|rpm|건|배)|무료|최신|최고|가장\s|출시|지원한다|가능하다/;

export interface VendorHit {
  /** 매칭된 고유명사 원문 (버전 포함) */
  term: string;
  /** 그 고유명사가 등장한 문장 */
  sentence: string;
}

/** 문장 단위로 쪼갠다. 마크다운 줄바꿈·리스트도 경계로 본다. */
export function splitSentences(text: string): string[] {
  return text
    .split(/(?<=[.!?。])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 태그도 출처도 없이 등장한 벤더 고유명사를 찾는다.
 * 스펙 §6.3: 같은 문장에 `[미검증]` 또는 출처 URL이 없으면 위반.
 */
export function findUntaggedVendorTerms(content: string): VendorHit[] {
  const hits: VendorHit[] = [];

  for (const sentence of splitSentences(content)) {
    if (TAG_RE.test(sentence) || URL_RE.test(sentence)) continue;

    const lower = sentence.toLowerCase();
    for (const keyword of ACTIVE_KEYWORDS) {
      let from = 0;
      for (;;) {
        const at = lower.indexOf(keyword, from);
        if (at === -1) break;
        from = at + keyword.length;

        const before = at === 0 ? '' : lower[at - 1]!;
        const after = lower[from] ?? '';
        // 단어 경계 확인 — "sonnet"이 "sonnets"에 걸리지 않게
        if (/[a-z0-9]/.test(before) || /[a-z]/.test(after)) continue;

        // 뒤따르는 버전 표기가 있으면 함께 잡는다
        const version = VERSION_SUFFIX.exec(sentence.slice(from));
        const term = sentence.slice(at, from + (version?.[0].length ?? 0));

        // 버전이 붙은 제품명이거나, 같은 문장에 검증 대상 주장이 있을 때만 잡는다.
        // 단순 언급("Vercel에 배포한다")은 통과시킨다 — §13 Q4.
        if (!version && !CLAIM_RE.test(sentence)) continue;

        hits.push({ term, sentence });
        break; // 같은 문장에서 같은 키워드는 1회만 보고
      }
    }
  }

  return hits;
}

/**
 * 이 말이 **[미검증] 딱지를 붙일 값어치가 있는가.**
 *
 * 빌더 지적(2026-09-03): 산출물의 미검증 목록에 `IndexedDB`, `GitHub Pages`,
 * 심지어 제품 이름까지 올라와 있었다. 확인할 주장이 없는 이름은 확인할 것도 없다.
 * 목록이 이름으로 가득 차면 정작 확인해야 할 가격·수치가 묻힌다.
 *
 * 기준은 §13 Q4에서 벤더 사전에 적용한 것과 같다 —
 * **버전·수치·가격 같은 검증 대상 주장이 붙어 있을 때만** 태그한다.
 *   "Gemini 3.7 Flash $0.75/1M"  → 붙인다 (가격)
 *   "Vercel 무료 티어"            → 붙인다 (무료 주장)
 *   "IndexedDB"                  → 안 붙인다 (확인할 주장이 없다)
 */
export function isVerifiableClaim(term: string): boolean {
  const t = term.trim();
  if (t === '') return false;
  // 숫자가 들어 있다고 다 주장은 아니다. "MP4"의 4는 확인할 것이 없다.
  // 앞이 띄어쓰기나 하이픈인 숫자만 버전·수치로 본다 — "GPT-4", "Claude Opus 5", "월 30일".
  return CLAIM_RE.test(t) || /[\s-]\d/.test(t);
}
