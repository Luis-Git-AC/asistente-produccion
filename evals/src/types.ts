import type { ModelId, SpriteSpec } from "@asistente/shared";
import type { EvalCase } from "./cases.js";

/** Tokens de una respuesta. Réplica local de la forma del SDK: evals no depende del server. */
export interface EvalUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export const EMPTY_EVAL_USAGE: EvalUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

/**
 * Resultado de un grader. `score` es continuo para que el agregado detecte degradaciones
 * parciales (un caso que pasa de 6/6 comprobaciones a 5/6 mueve la media aunque `passed`
 * siga siendo binario en otros casos); `detail` explica SIEMPRE qué se midió, tanto en el
 * fallo como en el acierto.
 */
export interface GraderResult {
  /** 0..1, donde 1 es "cumple del todo". */
  score: number;
  passed: boolean;
  detail: string;
}

export interface CaseGraderContext {
  evalCase: EvalCase;
  /** Texto crudo devuelto por el modelo (o grabado en el fixture), sin tocar. */
  rawText: string;
  /** `null` si el texto no parsea como JSON o no valida contra `SpriteSpec`. */
  spec: SpriteSpec | null;
  /** Mensajes de validación. Vacío cuando `spec` no es `null`. */
  issues: readonly string[];
  /** Lua emitido por el emisor real de `@asistente/mcp-aseprite`. `null` si no hay spec. */
  lua: string | null;
}

/** Grader que puntúa UN caso. */
export interface CaseGrader {
  id: string;
  description: string;
  /** `false` cuando el caso no declara la expectativa que este grader mide. */
  appliesTo(evalCase: EvalCase): boolean;
  grade(context: CaseGraderContext): GraderResult;
}

/** Resultado completo de un caso: transporte + puntuación. */
export interface CaseOutcome {
  caseId: string;
  tags: readonly string[];
  model: ModelId;
  source: "fixture" | "live";
  /** Latencia real de la llamada; en modo fixture, la que se grabó al recordarla. */
  latencyMs: number;
  usage: EvalUsage;
  costUsd: number;
  /** Fallo de transporte (red, API). `null` si la respuesta llegó, aunque no valide. */
  transportError: string | null;
  spec: SpriteSpec | null;
  /** Sólo los graders aplicables al caso, indexados por id. */
  graders: Record<string, GraderResult>;
  passed: boolean;
}

export interface RunGraderContext {
  outcomes: readonly CaseOutcome[];
  budgets: Budgets;
  /** Índice por id para los graders que cruzan casos entre sí. */
  casesById: ReadonlyMap<string, EvalCase>;
}

/**
 * Grader que puntúa la CORRIDA entera (presupuestos, coherencia entre casos).
 * Devuelve `null` cuando la corrida no contiene lo que necesita medir — por ejemplo
 * `--case <id>` deja fuera al caso equivalente en el otro idioma.
 */
export interface RunGrader {
  id: string;
  description: string;
  grade(context: RunGraderContext): GraderResult | null;
}

export interface Budgets {
  /** p95 de latencia por sprite, en ms. */
  latencyP95Ms: number;
  /** Coste medio por sprite, en USD. */
  costPerSpriteUsd: number;
}

export interface Thresholds {
  /** Media mínima por grader de caso, indexada por id de grader. */
  graders: Record<string, number>;
  budgets: Budgets;
  /** Fracción mínima de casos en los que TODOS sus graders aplicables pasan. */
  minCasePassRate: number;
}

export interface GraderAggregate {
  graderId: string;
  /** Media de `score` sobre los casos a los que aplica. */
  mean: number;
  min: number;
  /** Número de casos evaluados por este grader. */
  cases: number;
  failedCases: readonly string[];
  threshold: number;
  passed: boolean;
}

export interface RunTotals {
  cases: number;
  passedCases: number;
  passRate: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  costPerSpriteUsd: number;
  latencyP50Ms: number;
  latencyP95Ms: number;
}

export interface RunReport {
  /** Versión del formato del propio informe, no del `SpriteSpec`. */
  reportVersion: string;
  generatedAt: string;
  source: "fixtures" | "live";
  model: ModelId;
  specSchemaVersion: string;
  totals: RunTotals;
  cases: readonly CaseOutcome[];
  graders: readonly GraderAggregate[];
  runGraders: readonly (GraderResult & { graderId: string })[];
  /** Motivos por los que la corrida sale con código ≠ 0. Vacío si todo pasa. */
  failures: readonly string[];
  regressions: readonly string[];
}
