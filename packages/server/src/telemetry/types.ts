import type { ModelId } from "@asistente/shared";

/**
 * Contrato de telemetría. El resto del código habla con `MetricsRepository`, nunca con SQL:
 * cambiar SQLite por Mongo debe ser cambiar una implementación, no tocar las rutas.
 */

export type CacheOutcome = "hit" | "miss";
export type RequestStatus = "ok" | "error";

/** Una petición completa, con las latencias desglosadas por etapa. */
export interface RequestMetrics {
  requestId: string;
  /** Hash del prompt, no el prompt: la telemetría no necesita guardar el texto del usuario. */
  promptHash: string;
  /** Prompt truncado, para la tabla de peticiones recientes del dashboard. */
  promptPreview: string;
  model: ModelId;
  attempts: number;
  fellBack: boolean;
  cache: CacheOutcome;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  /** Latencias SEPARADAS: sin esto no se sabe si el tiempo se va en el modelo o en el render. */
  llmMs: number;
  validateMs: number;
  renderMs: number;
  totalMs: number;
  status: RequestStatus;
  errorCode: string | null;
  filePath: string | null;
  spritesheetPath: string | null;
  createdAt: number;
}

export interface LatencyPercentiles {
  p50: number;
  p95: number;
}

export interface ModelBreakdown {
  model: ModelId;
  requests: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
}

/** Agregados que devuelve `GET /api/metrics`. Se calculan en el servidor, no en el cliente. */
export interface MetricsAggregate {
  windowMs: number;
  since: number;
  requests: number;
  errors: number;
  totalCostUsd: number;
  averageCostUsd: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheCreationTokens: number;
  cacheHits: number;
  cacheHitRate: number;
  fallbackRate: number;
  llmLatency: LatencyPercentiles;
  renderLatency: LatencyPercentiles;
  totalLatency: LatencyPercentiles;
  byModel: ModelBreakdown[];
}

export interface MetricsRepository {
  record(metrics: RequestMetrics): void;
  aggregate(options: { windowMs: number; now?: number }): MetricsAggregate;
  recent(limit: number): RequestMetrics[];
  close(): void;
}
