import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import type { ModelId } from "@asistente/shared";
import type {
  CacheOutcome,
  LatencyPercentiles,
  MetricsAggregate,
  MetricsRepository,
  ModelBreakdown,
  RequestMetrics,
  RequestStatus,
} from "./types.js";

/**
 * Implementación SQLite de `MetricsRepository`. **Este es el único fichero del paquete que
 * contiene SQL.** Todo lo demás habla contra la interfaz.
 */

interface MetricsRow {
  request_id: string;
  prompt_hash: string;
  prompt_preview: string;
  model: string;
  attempts: number;
  fell_back: number;
  cache: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_creation_tokens: number;
  cost_usd: number;
  llm_ms: number;
  validate_ms: number;
  render_ms: number;
  total_ms: number;
  status: string;
  error_code: string | null;
  file_path: string | null;
  spritesheet_path: string | null;
  created_at: number;
}

function rowToMetrics(row: MetricsRow): RequestMetrics {
  return {
    requestId: row.request_id,
    promptHash: row.prompt_hash,
    promptPreview: row.prompt_preview,
    model: row.model as ModelId,
    attempts: row.attempts,
    fellBack: row.fell_back === 1,
    cache: row.cache as CacheOutcome,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    costUsd: row.cost_usd,
    llmMs: row.llm_ms,
    validateMs: row.validate_ms,
    renderMs: row.render_ms,
    totalMs: row.total_ms,
    status: row.status as RequestStatus,
    errorCode: row.error_code,
    filePath: row.file_path,
    spritesheetPath: row.spritesheet_path,
    createdAt: row.created_at,
  };
}

/**
 * Percentil por interpolación lineal sobre una muestra ya ordenada (método "linear" de NumPy).
 * Se calcula en JS y no con SQL porque SQLite no trae función de percentil y emularla con
 * ventanas es más frágil que ordenar unas cuantas filas.
 */
export function percentile(sortedValues: readonly number[], fraction: number): number {
  if (sortedValues.length === 0) return 0;
  if (sortedValues.length === 1) return sortedValues[0]!;

  const rank = (sortedValues.length - 1) * fraction;
  const lowerIndex = Math.floor(rank);
  const upperIndex = Math.ceil(rank);
  const lower = sortedValues[lowerIndex]!;
  if (lowerIndex === upperIndex) return lower;

  const upper = sortedValues[upperIndex]!;
  return lower + (upper - lower) * (rank - lowerIndex);
}

function percentilesOf(values: number[]): LatencyPercentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return { p50: percentile(sorted, 0.5), p95: percentile(sorted, 0.95) };
}

export interface SqliteMetricsRepositoryOptions {
  dbPath?: string;
  now?: () => number;
}

export class SqliteMetricsRepository implements MetricsRepository {
  readonly #db: Database.Database;
  readonly #now: () => number;

  constructor(options: SqliteMetricsRepositoryOptions = {}) {
    const dbPath = options.dbPath ?? ":memory:";
    if (dbPath !== ":memory:") {
      mkdirSync(dirname(dbPath), { recursive: true });
    }
    this.#db = new Database(dbPath);
    this.#db.pragma("journal_mode = WAL");
    this.#now = options.now ?? Date.now;

    this.#db.exec(`
      CREATE TABLE IF NOT EXISTS request_metrics (
        request_id TEXT PRIMARY KEY,
        prompt_hash TEXT NOT NULL,
        prompt_preview TEXT NOT NULL,
        model TEXT NOT NULL,
        attempts INTEGER NOT NULL,
        fell_back INTEGER NOT NULL,
        cache TEXT NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER NOT NULL,
        cache_creation_tokens INTEGER NOT NULL,
        cost_usd REAL NOT NULL,
        llm_ms INTEGER NOT NULL,
        validate_ms INTEGER NOT NULL,
        render_ms INTEGER NOT NULL,
        total_ms INTEGER NOT NULL,
        status TEXT NOT NULL,
        error_code TEXT,
        file_path TEXT,
        spritesheet_path TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_request_metrics_created_at
        ON request_metrics (created_at);
    `);
  }

  record(metrics: RequestMetrics): void {
    this.#db
      .prepare(
        `INSERT INTO request_metrics (
           request_id, prompt_hash, prompt_preview, model, attempts, fell_back, cache,
           input_tokens, output_tokens, cache_read_tokens, cache_creation_tokens, cost_usd,
           llm_ms, validate_ms, render_ms, total_ms, status, error_code,
           file_path, spritesheet_path, created_at
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(request_id) DO NOTHING`,
      )
      .run(
        metrics.requestId,
        metrics.promptHash,
        metrics.promptPreview,
        metrics.model,
        metrics.attempts,
        metrics.fellBack ? 1 : 0,
        metrics.cache,
        metrics.inputTokens,
        metrics.outputTokens,
        metrics.cacheReadTokens,
        metrics.cacheCreationTokens,
        metrics.costUsd,
        metrics.llmMs,
        metrics.validateMs,
        metrics.renderMs,
        metrics.totalMs,
        metrics.status,
        metrics.errorCode,
        metrics.filePath,
        metrics.spritesheetPath,
        metrics.createdAt,
      );
  }

  aggregate(options: { windowMs: number; now?: number }): MetricsAggregate {
    const now = options.now ?? this.#now();
    const since = now - options.windowMs;

    // La ventana está acotada por ARRIBA además de por abajo. Sin la cota superior, pedir la
    // ventana anterior (`now: since`) devolvía también la actual y los deltas salían mal.
    const rows = this.#db
      .prepare<[number, number], MetricsRow>(
        `SELECT * FROM request_metrics
         WHERE created_at >= ? AND created_at <= ?
         ORDER BY created_at ASC`,
      )
      .all(since, now)
      .map(rowToMetrics);

    const empty: MetricsAggregate = {
      windowMs: options.windowMs,
      since,
      requests: 0,
      errors: 0,
      totalCostUsd: 0,
      averageCostUsd: 0,
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheCreationTokens: 0,
      cacheHits: 0,
      cacheHitRate: 0,
      fallbackRate: 0,
      llmLatency: { p50: 0, p95: 0 },
      renderLatency: { p50: 0, p95: 0 },
      totalLatency: { p50: 0, p95: 0 },
      byModel: [],
    };
    if (rows.length === 0) return empty;

    const totals = rows.reduce(
      (acc, row) => ({
        cost: acc.cost + row.costUsd,
        input: acc.input + row.inputTokens,
        output: acc.output + row.outputTokens,
        cacheRead: acc.cacheRead + row.cacheReadTokens,
        cacheCreation: acc.cacheCreation + row.cacheCreationTokens,
        hits: acc.hits + (row.cache === "hit" ? 1 : 0),
        fellBack: acc.fellBack + (row.fellBack ? 1 : 0),
        errors: acc.errors + (row.status === "error" ? 1 : 0),
      }),
      { cost: 0, input: 0, output: 0, cacheRead: 0, cacheCreation: 0, hits: 0, fellBack: 0, errors: 0 },
    );

    const byModelMap = new Map<ModelId, ModelBreakdown>();
    for (const row of rows) {
      const current = byModelMap.get(row.model) ?? {
        model: row.model,
        requests: 0,
        costUsd: 0,
        inputTokens: 0,
        outputTokens: 0,
      };
      current.requests += 1;
      current.costUsd += row.costUsd;
      current.inputTokens += row.inputTokens;
      current.outputTokens += row.outputTokens;
      byModelMap.set(row.model, current);
    }

    return {
      windowMs: options.windowMs,
      since,
      requests: rows.length,
      errors: totals.errors,
      totalCostUsd: totals.cost,
      averageCostUsd: totals.cost / rows.length,
      totalInputTokens: totals.input,
      totalOutputTokens: totals.output,
      totalCacheReadTokens: totals.cacheRead,
      totalCacheCreationTokens: totals.cacheCreation,
      cacheHits: totals.hits,
      cacheHitRate: totals.hits / rows.length,
      fallbackRate: totals.fellBack / rows.length,
      // Las latencias de LLM y render se miden sólo donde esa etapa ocurrió: incluir los ceros
      // de un cache hit hundiría el p50 del modelo y contaría una mejora que no existe.
      llmLatency: percentilesOf(rows.filter((r) => r.cache === "miss").map((r) => r.llmMs)),
      renderLatency: percentilesOf(rows.filter((r) => r.renderMs > 0).map((r) => r.renderMs)),
      totalLatency: percentilesOf(rows.map((r) => r.totalMs)),
      byModel: [...byModelMap.values()].sort((a, b) => b.requests - a.requests),
    };
  }

  recent(limit: number): RequestMetrics[] {
    return this.#db
      .prepare<[number], MetricsRow>(
        `SELECT * FROM request_metrics ORDER BY created_at DESC LIMIT ?`,
      )
      .all(limit)
      .map(rowToMetrics);
  }

  close(): void {
    this.#db.close();
  }
}
