import {
  DEFAULT_COST_PER_SPRITE_THRESHOLD_USD,
  FALLBACK_RATE_THRESHOLD,
  MIN_EVENTS_FOR_RATE_ALERT,
  MIN_REQUESTS_FOR_RATE_ALERT,
  type CostBucket,
  type DashboardAlert,
  type DashboardPayload,
  type FallbackPoint,
  type PreviousWindow,
  type RecentRequest,
  type StageLatency,
  type TokenPoint,
} from "@asistente/shared";
import { toAssetUrl } from "../routes/assets.js";
import { percentile } from "./sqlite-repository.js";
import type { MetricsRepository, RequestMetrics } from "./types.js";

/**
 * Construye el payload del dashboard a partir de las filas crudas.
 *
 * Vive en el servidor a propósito: el cliente pinta y no agrega. Meter este cálculo en React
 * significaría transferir miles de filas al navegador para reducirlas allí.
 */

const DAY_MS = 86_400_000;
/** Nº de intervalos de la serie de coste. Suficiente para ver forma sin ruido de sierra. */
const COST_BUCKETS = 24;
/** Últimas peticiones que se muestran en el gráfico de tokens. */
const TOKEN_SERIES_LIMIT = 30;

function percentilesOf(values: number[]): { p50: number; p95: number } {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** Agrupa el coste en intervalos regulares y lleva el acumulado. */
export function buildCostSeries(
  rows: readonly RequestMetrics[],
  since: number,
  now: number,
  buckets = COST_BUCKETS,
): CostBucket[] {
  const span = Math.max(1, now - since);
  const width = span / buckets;

  const series: CostBucket[] = Array.from({ length: buckets }, (_, index) => ({
    startMs: Math.round(since + index * width),
    costByModel: {},
    cumulativeUsd: 0,
    requests: 0,
  }));

  for (const row of rows) {
    const index = Math.min(buckets - 1, Math.max(0, Math.floor((row.createdAt - since) / width)));
    const bucket = series[index];
    if (bucket === undefined) continue;
    bucket.costByModel[row.model] = (bucket.costByModel[row.model] ?? 0) + row.costUsd;
    bucket.requests += 1;
  }

  let runningTotal = 0;
  for (const bucket of series) {
    runningTotal += Object.values(bucket.costByModel).reduce((sum, value) => sum + value, 0);
    bucket.cumulativeUsd = runningTotal;
  }

  return series;
}

/**
 * Reparto del tiempo por etapa.
 *
 * Cada etapa promedia sólo donde ocurrió: las latencias de LLM excluyen los cache hits y las de
 * render los ceros. Incluir esos ceros hunde la media y finge una mejora que no existe.
 */
export function buildStageLatency(rows: readonly RequestMetrics[]): StageLatency[] {
  const llm = rows.filter((row) => row.cache === "miss").map((row) => row.llmMs);
  const validate = rows.map((row) => row.validateMs);
  const render = rows.filter((row) => row.renderMs > 0).map((row) => row.renderMs);

  const stages: Array<{ stage: StageLatency["stage"]; values: number[] }> = [
    { stage: "llm", values: llm },
    { stage: "validate", values: validate },
    { stage: "render", values: render },
  ];

  const means = stages.map((entry) => mean(entry.values));
  const totalMean = means.reduce((sum, value) => sum + value, 0);

  return stages.map((entry, index) => {
    const meanMs = means[index] ?? 0;
    const { p50, p95 } = percentilesOf(entry.values);
    return {
      stage: entry.stage,
      meanMs,
      p50Ms: p50,
      p95Ms: p95,
      share: totalMean === 0 ? 0 : meanMs / totalMean,
    };
  });
}

export function buildTokenSeries(rows: readonly RequestMetrics[], limit = TOKEN_SERIES_LIMIT): TokenPoint[] {
  return rows
    .slice(-limit)
    .map((row) => ({
      requestId: row.requestId,
      createdAt: row.createdAt,
      inputTokens: row.inputTokens,
      outputTokens: row.outputTokens,
      cacheReadTokens: row.cacheReadTokens,
      cacheCreationTokens: row.cacheCreationTokens,
    }));
}

/** Tasa de fallback y media de intentos, por día. */
export function buildFallbackSeries(rows: readonly RequestMetrics[]): FallbackPoint[] {
  const byDay = new Map<number, { requests: number; fallbacks: number; attempts: number }>();

  for (const row of rows) {
    const dayMs = Math.floor(row.createdAt / DAY_MS) * DAY_MS;
    const entry = byDay.get(dayMs) ?? { requests: 0, fallbacks: 0, attempts: 0 };
    entry.requests += 1;
    entry.fallbacks += row.fellBack ? 1 : 0;
    entry.attempts += row.attempts;
    byDay.set(dayMs, entry);
  }

  return [...byDay.entries()]
    .sort(([a], [b]) => a - b)
    .map(([dayMs, entry]) => ({
      dayMs,
      requests: entry.requests,
      fallbacks: entry.fallbacks,
      rate: entry.requests === 0 ? 0 : entry.fallbacks / entry.requests,
      meanAttempts: entry.requests === 0 ? 0 : entry.attempts / entry.requests,
    }));
}

export interface AlertOptions {
  costPerSpriteThresholdUsd?: number;
}

/**
 * Alertas que se muestran en la UI, no en un log que nadie lee.
 *
 * La del prompt caching es la más valiosa: un `cache_read_input_tokens` a 0 en peticiones
 * repetidas significa que algo volátil se ha colado en el prefijo del system prompt (un
 * timestamp, un id) y el caching dejó de funcionar sin dar ningún error.
 */
export function buildAlerts(
  rows: readonly RequestMetrics[],
  options: AlertOptions = {},
): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];
  if (rows.length === 0) return alerts;

  const threshold = options.costPerSpriteThresholdUsd ?? DEFAULT_COST_PER_SPRITE_THRESHOLD_USD;

  // 1. Invalidador silencioso del prefijo cacheado.
  const byPrompt = new Map<string, RequestMetrics[]>();
  for (const row of rows) {
    byPrompt.set(row.promptHash, [...(byPrompt.get(row.promptHash) ?? []), row]);
  }
  const repeatedMisses = [...byPrompt.values()].filter(
    (group) =>
      group.length > 1 &&
      group.every((row) => row.cache === "miss" && row.cacheReadTokens === 0),
  );
  if (repeatedMisses.length > 0) {
    alerts.push({
      id: "cache-prefix-invalidated",
      level: "warning",
      title: "El prompt caching no está funcionando",
      detail: `${String(repeatedMisses.length)} prompt(s) repetidos sin un solo token leído de caché.`,
      action:
        "Algo volátil se ha colado en el prefijo del system prompt (un timestamp, un id). Revisa src/llm/prompts/.",
    });
  }

  // 2. Tasa de fallback.
  //
  // Se exige evidencia mínima antes de convertir un cociente en una alerta: con una muestra
  // pequeña, un solo fallback se disfraza de tendencia (1 de 7 = 14 %, 1 de 3 = 33 % y crítico)
  // y manda a buscar un incidente que no existe. Ver MIN_*_FOR_RATE_ALERT en @asistente/shared.
  const fallbacks = rows.filter((row) => row.fellBack).length;
  const fallbackRate = fallbacks / rows.length;
  const hasEnoughEvidence =
    rows.length >= MIN_REQUESTS_FOR_RATE_ALERT && fallbacks >= MIN_EVENTS_FOR_RATE_ALERT;
  if (hasEnoughEvidence && fallbackRate > FALLBACK_RATE_THRESHOLD) {
    alerts.push({
      id: "fallback-rate-high",
      level: fallbackRate > 0.3 ? "critical" : "warning",
      title: "Tasa de fallback alta",
      // El denominador va en el texto: un porcentaje suelto no deja juzgar si es señal o ruido,
      // que es justo lo que hay que decidir al leer esta alerta.
      detail:
        `${String(fallbacks)} de ${String(rows.length)} peticiones ` +
        `(${(fallbackRate * 100).toFixed(0)} %) cayeron al modelo secundario.`,
      action:
        "Si SIMULATE_5XX no está activo, el modelo primario está fallando de verdad: revisa el log del servidor.",
    });
  }

  // 3. Coste por sprite.
  const paid = rows.filter((row) => row.cache === "miss");
  const averagePaid = paid.length === 0 ? 0 : mean(paid.map((row) => row.costUsd));
  if (averagePaid > threshold) {
    alerts.push({
      id: "cost-per-sprite-high",
      level: "warning",
      title: "Coste por sprite por encima del umbral",
      detail: `$${averagePaid.toFixed(4)} de media, umbral $${threshold.toFixed(2)}.`,
      action: "Baja el effort, acorta el prompt o usa un modelo más barato para iterar.",
    });
  }

  return alerts;
}

function toRecentRequest(row: RequestMetrics): RecentRequest {
  return {
    requestId: row.requestId,
    promptPreview: row.promptPreview,
    model: row.model,
    cache: row.cache,
    attempts: row.attempts,
    fellBack: row.fellBack,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    costUsd: row.costUsd,
    llmMs: row.llmMs,
    renderMs: row.renderMs,
    totalMs: row.totalMs,
    status: row.status,
    errorCode: row.errorCode,
    spritesheetUrl: toAssetUrl(row.spritesheetPath),
    createdAt: row.createdAt,
  };
}

export interface BuildDashboardOptions {
  windowMs: number;
  now: number;
  recentLimit?: number;
  costPerSpriteThresholdUsd?: number;
}

export function buildDashboard(
  repository: MetricsRepository,
  options: BuildDashboardOptions,
): DashboardPayload {
  const { windowMs, now } = options;
  const since = now - windowMs;

  const current = repository.aggregate({ windowMs, now });
  // Ventana anterior, del mismo tamaño, para los deltas de los KPIs.
  const previousAggregate = repository.aggregate({ windowMs, now: since });
  const previous: PreviousWindow | null =
    previousAggregate.requests === 0
      ? null
      : {
          requests: previousAggregate.requests,
          totalCostUsd: previousAggregate.totalCostUsd,
          averageCostUsd: previousAggregate.averageCostUsd,
          cacheHitRate: previousAggregate.cacheHitRate,
          totalLatencyP95: previousAggregate.totalLatency.p95,
        };

  // Se piden más filas de las que se muestran: las series necesitan toda la ventana.
  const rows = repository
    .recent(2000)
    .filter((row) => row.createdAt >= since && row.createdAt <= now)
    .sort((a, b) => a.createdAt - b.createdAt);

  return {
    windowMs,
    since,
    now,
    requests: current.requests,
    errors: current.errors,
    totalCostUsd: current.totalCostUsd,
    averageCostUsd: current.averageCostUsd,
    totalInputTokens: current.totalInputTokens,
    totalOutputTokens: current.totalOutputTokens,
    totalCacheReadTokens: current.totalCacheReadTokens,
    totalCacheCreationTokens: current.totalCacheCreationTokens,
    cacheHits: current.cacheHits,
    cacheHitRate: current.cacheHitRate,
    fallbackRate: current.fallbackRate,
    llmLatency: current.llmLatency,
    renderLatency: current.renderLatency,
    totalLatency: current.totalLatency,
    byModel: current.byModel,
    previous,
    costSeries: buildCostSeries(rows, since, now),
    stageLatency: buildStageLatency(rows),
    tokenSeries: buildTokenSeries(rows),
    fallbackSeries: buildFallbackSeries(rows),
    alerts: buildAlerts(rows, {
      ...(options.costPerSpriteThresholdUsd === undefined
        ? {}
        : { costPerSpriteThresholdUsd: options.costPerSpriteThresholdUsd }),
    }),
    recent: [...rows].reverse().slice(0, options.recentLimit ?? 50).map(toRecentRequest),
  };
}
