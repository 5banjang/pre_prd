// 모델·단가·튜닝 값의 단일 출처 — 스펙 §9.
// 모델을 바꿀 때 이 파일만 고친다.

export interface ModelConfig {
  id: string;
  label: string;
  inputPer1M: number;
  outputPer1M: number;
  /** 벤더 공식 가격표를 직접 확인했는가. 확인 전에는 UI에 [미검증] 배지를 띄운다. */
  verified: boolean;
  checkedAt: string | null;
  sourceUrl: string | null;
  caveat: string | null;
}

/**
 * 엔진 모델. 모델 ID는 Models API로 실측 확인했다(2026-08-27) — 추측이 아니다.
 *
 * Pro 티어(`gemini-3.1-pro-preview`)는 프리뷰만 존재해 채택하지 않았다.
 * 정식 승격 시 재검토한다.
 */
export const ENGINE_MODEL: ModelConfig = {
  id: 'gemini-3.7-flash',
  label: 'Gemini 3.7 Flash',
  // TODO(확인 필요): 빌더 제공 자료 기준. 공식 가격표 확인 후 verified를 뒤집을 것.
  inputPer1M: 0.75,
  outputPer1M: 3.75,
  verified: false,
  checkedAt: null,
  sourceUrl: 'https://aistudio.google.com/pricing',
  caveat: '도입가. 2027-01-01에 2배 인상 예정',
};

export const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/**
 * thinking 토큰은 출력 토큰으로 청구된다.
 * 실측(2026-08-27): 무제한이면 출력의 85%가 thinking(300/354). 512로 제한 시 92토큰, 품질 저하 없음.
 */
export const THINKING_BUDGET = 512;

/** 프롬프트에 넣을 최근 대화 턴 수 — 스펙 §5.1. 상태 JSON에 확정 내용이 있으므로 원문은 최근 것만 필요하다. */
export const MAX_HISTORY_TURNS = 6;

/** 스키마 위반 시 재요청 횟수 — FR-004. 최초 시도 포함 총 3회. */
export const MAX_SCHEMA_RETRIES = 2;

/** 429 지수 백오프 재시도 횟수 — 스펙 §11. */
export const MAX_RATE_LIMIT_RETRIES = 3;

/**
 * TODO(확인 필요): 원화 예산(S0)과 USD 원가(costModel)를 비교하려면 환율이 필요하다.
 * 스펙에 규정이 없다. 사용자 확인 후 확정할 것.
 */
export const KRW_PER_USD = 1400;

/** 누적 토큰으로 추정 비용(USD)을 낸다 — FR-012. */
export function estimateCost(inputTokens: number, outputTokens: number): number {
  return (inputTokens / 1_000_000) * ENGINE_MODEL.inputPer1M
    + (outputTokens / 1_000_000) * ENGINE_MODEL.outputPer1M;
}
