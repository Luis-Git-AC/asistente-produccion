import type { ModelId } from "./pricing.js";

/**
 * Contrato del dashboard entre servidor y web.
 *
 * Todos los agregados y series se calculan en el SERVIDOR. El cliente pinta: no hace `reduce`
 * sobre miles de filas ni recalcula el coste (para eso está `estimateCostUsd` en shared, y se
 * usa una sola vez, al registrar la petición).
 */

/** Un punto de la serie de coste, con el desglose por modelo de ese intervalo. */
export interface CostBucket {
  /** Inicio del intervalo, epoch ms. */
  startMs: number;
  /** Coste del intervalo por modelo. Los modelos ausentes valen 0. */
  costByModel: Record<string, number>;
  /** Coste acumulado hasta el final de este intervalo, sumando todos los modelos. */
  cumulativeUsd: number;
  requests: number;
}

/** Reparto del tiempo entre etapas. Es lo que responde "¿dónde se va el tiempo?". */
export interface StageLatency {
  stage: "llm" | "validate" | "render";
  /** Media en ms sobre las peticiones de la ventana. */
  meanMs: number;
  p50Ms: number;
  p95Ms: number;
  /** Fracción del tiempo total, 0..1. */
  share: number;
}

/** Tokens de una petición concreta, para ver el efecto del prompt caching. */
export interface TokenPoint {
  requestId: string;
  createdAt: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
}

export interface FallbackPoint {
  /** Inicio del día, epoch ms. */
  dayMs: number;
  requests: number;
  fallbacks: number;
  /** 0..1 */
  rate: number;
  /** Media de intentos por petición ese día. */
  meanAttempts: number;
}

export type AlertLevel = "warning" | "critical";

export interface DashboardAlert {
  id: string;
  level: AlertLevel;
  title: string;
  detail: string;
  /** Qué hacer al respecto. Una alerta sin acción es ruido. */
  action: string;
}

/** Valores de la ventana anterior, para calcular deltas en los KPIs. */
export interface PreviousWindow {
  requests: number;
  totalCostUsd: number;
  averageCostUsd: number;
  cacheHitRate: number;
  totalLatencyP95: number;
}

export interface DashboardPayload {
  windowMs: number;
  since: number;
  now: number;

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

  llmLatency: { p50: number; p95: number };
  renderLatency: { p50: number; p95: number };
  totalLatency: { p50: number; p95: number };

  byModel: Array<{
    model: ModelId;
    requests: number;
    costUsd: number;
    inputTokens: number;
    outputTokens: number;
  }>;

  /** `null` cuando no hay datos de la ventana anterior con los que comparar. */
  previous: PreviousWindow | null;
  costSeries: CostBucket[];
  stageLatency: StageLatency[];
  tokenSeries: TokenPoint[];
  fallbackSeries: FallbackPoint[];
  alerts: DashboardAlert[];
  recent: RecentRequest[];
}

/** Fila de la tabla de peticiones recientes. */
export interface RecentRequest {
  requestId: string;
  promptPreview: string;
  model: ModelId;
  cache: "hit" | "miss";
  attempts: number;
  fellBack: boolean;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  llmMs: number;
  renderMs: number;
  totalMs: number;
  status: "ok" | "error";
  errorCode: string | null;
  /** URL servible del spritesheet, o `null` si la petición no llegó a producirlo. */
  spritesheetUrl: string | null;
  createdAt: number;
}

/** Umbral por defecto de coste por sprite que dispara la alerta, en USD. */
export const DEFAULT_COST_PER_SPRITE_THRESHOLD_USD = 0.25;

/** Tasa de fallback por encima de la cual se avisa. */
export const FALLBACK_RATE_THRESHOLD = 0.1;

/**
 * Evidencia mínima para que una alerta basada en una PROPORCIÓN pueda dispararse.
 *
 * Una tasa calculada sobre pocas peticiones no mide el sistema, mide el ruido: con 7 peticiones
 * en la ventana, una sola que caiga al modelo secundario ya da un 14 % y cruza el umbral del
 * 10 %; con 3 peticiones daría un 33 % y escalaría a "crítico". El resultado es una alerta que
 * grita por un mecanismo que funcionó exactamente como debía.
 *
 * Por eso hacen falta las dos condiciones a la vez:
 *
 * - `MIN_REQUESTS_FOR_RATE_ALERT` — denominador suficiente para que el cociente signifique algo.
 * - `MIN_EVENTS_FOR_RATE_ALERT` — un único suceso nunca es una tendencia, sea cual sea el
 *   denominador. Es la condición que mata el falso positivo de raíz.
 *
 * El mínimo se deja bajo (y no en, digamos, 20) a propósito: una caída real del modelo primario
 * produce muchos fallbacks seguidos, así que 5 de 10 sigue avisando. Lo que se silencia es el
 * caso de "uno de pocos", no el incidente.
 */
export const MIN_REQUESTS_FOR_RATE_ALERT = 10;
export const MIN_EVENTS_FOR_RATE_ALERT = 2;
