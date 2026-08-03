export const MODEL_IDS = ["claude-opus-5", "claude-sonnet-5"] as const;
export type ModelId = (typeof MODEL_IDS)[number];

interface ModelPricing {
  /** USD por millón de tokens de entrada (no cacheados). */
  inputPerMTok: number;
  /** USD por millón de tokens de salida. */
  outputPerMTok: number;
}

/** Cache read ≈ 0.1× el precio de input; cache write ≈ 1.25× el precio de input. */
const CACHE_READ_MULTIPLIER = 0.1;
const CACHE_WRITE_MULTIPLIER = 1.25;

export const MODEL_PRICING: Record<ModelId, ModelPricing> = {
  "claude-opus-5": { inputPerMTok: 5, outputPerMTok: 25 },
  "claude-sonnet-5": { inputPerMTok: 3, outputPerMTok: 15 },
};

export interface EstimateCostUsdInput {
  model: ModelId;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
}

const TOKENS_PER_MTOK = 1_000_000;

export function estimateCostUsd(input: EstimateCostUsdInput): number {
  const pricing = MODEL_PRICING[input.model];
  const cacheReadTokens = input.cacheReadTokens ?? 0;
  const cacheCreationTokens = input.cacheCreationTokens ?? 0;

  const inputCost = (input.inputTokens * pricing.inputPerMTok) / TOKENS_PER_MTOK;
  const outputCost = (input.outputTokens * pricing.outputPerMTok) / TOKENS_PER_MTOK;
  const cacheReadCost =
    (cacheReadTokens * pricing.inputPerMTok * CACHE_READ_MULTIPLIER) / TOKENS_PER_MTOK;
  const cacheCreationCost =
    (cacheCreationTokens * pricing.inputPerMTok * CACHE_WRITE_MULTIPLIER) / TOKENS_PER_MTOK;

  return inputCost + outputCost + cacheReadCost + cacheCreationCost;
}
