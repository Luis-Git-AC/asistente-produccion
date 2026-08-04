import {
  SPRITE_SPEC_SCHEMA_VERSION,
  SpriteSpecSchema,
  estimateCostUsd,
  type ModelId,
  type SpriteSpec,
} from "@asistente/shared";
import { emitGenerateSpriteLua } from "@asistente/mcp-aseprite";
import type { EvalCase } from "./cases.js";
import { CASE_GRADERS, RUN_GRADERS } from "./graders/index.js";
import { mean, percentile } from "./graders/checks.js";
import type { ResponseSource } from "./response-source.js";
import type {
  CaseOutcome,
  GraderAggregate,
  GraderResult,
  RunReport,
  RunTotals,
  Thresholds,
} from "./types.js";

export const REPORT_VERSION = "1.0.0";

/**
 * Rutas ficticias para el emisor de Lua. Los graders operan sobre el `SpriteSpec` y sobre el Lua
 * **emitido**; nada aquí abre Aseprite ni escribe un `.aseprite`, por eso las rutas no existen y
 * son constantes: si dependieran del sistema de ficheros, el script emitido cambiaría entre
 * máquinas y el grader dejaría de ser determinista.
 */
const LUA_PATHS = {
  asepritePath: "/evals/output/spec.aseprite",
  spritesheetPath: "/evals/output/spec.png",
  jsonPath: "/evals/output/spec.json",
} as const;

/**
 * Extrae el primer objeto JSON del texto, tolerando que el modelo lo envuelva en ```json.
 * Réplica deliberada de `parseSpecJson` de `packages/server`: la eval no puede importar el
 * servidor en modo `--fixtures` (arrastraría Express y SQLite), y copiar quince líneas es más
 * barato que abrir una dependencia de la suite offline al backend entero.
 */
function parseSpecJson(text: string): { value: unknown } | { error: string } {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return { value: JSON.parse(candidate) };
  } catch (error) {
    return { error: `la respuesta no es JSON válido: ${(error as Error).message}` };
  }
}

interface ValidationOutcome {
  spec: SpriteSpec | null;
  issues: string[];
}

export function validateResponse(rawText: string): ValidationOutcome {
  if (rawText.trim() === "") return { spec: null, issues: ["respuesta vacía"] };

  const parsed = parseSpecJson(rawText);
  if ("error" in parsed) return { spec: null, issues: [parsed.error] };

  const result = SpriteSpecSchema.safeParse(parsed.value);
  if (!result.success) {
    return {
      spec: null,
      issues: result.error.issues.map(
        (issue) => `${issue.path.join(".") || "<raíz>"}: ${issue.message}`,
      ),
    };
  }
  return { spec: result.data, issues: [] };
}

function safeEmitLua(spec: SpriteSpec | null): string | null {
  if (spec === null) return null;
  try {
    return emitGenerateSpriteLua(spec, LUA_PATHS);
  } catch {
    // Un emisor que revienta con un spec válido es un fallo del emisor, y el grader de Lua lo
    // reporta como "no hay Lua que medir" en vez de tumbar la corrida entera.
    return null;
  }
}

async function runCase(
  evalCase: EvalCase,
  model: ModelId,
  source: ResponseSource,
): Promise<CaseOutcome> {
  const response = await source.fetch(evalCase, model);
  const { spec, issues } =
    response.transportError === null
      ? validateResponse(response.rawText)
      : { spec: null, issues: [`fallo de transporte: ${response.transportError}`] };
  const lua = safeEmitLua(spec);

  const graders: Record<string, GraderResult> = {};
  for (const grader of CASE_GRADERS) {
    if (!grader.appliesTo(evalCase)) continue;
    graders[grader.id] = grader.grade({
      evalCase,
      rawText: response.rawText,
      spec,
      issues,
      lua,
    });
  }

  return {
    caseId: evalCase.id,
    tags: evalCase.tags,
    model,
    source: response.source,
    latencyMs: response.latencyMs,
    usage: response.usage,
    costUsd: estimateCostUsd({
      model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheReadTokens: response.usage.cache_read_input_tokens,
      cacheCreationTokens: response.usage.cache_creation_input_tokens,
    }),
    transportError: response.transportError,
    spec,
    graders,
    passed: Object.values(graders).every((result) => result.passed),
  };
}

/** Pool de concurrencia mínimo. Preserva el orden de entrada en la salida. */
async function mapWithConcurrency<T, R>(
  items: readonly T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;

  const runners = Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      const item = items[index];
      if (item === undefined) return;
      results[index] = await worker(item, index);
    }
  });

  await Promise.all(runners);
  return results;
}

function aggregateGraders(
  outcomes: readonly CaseOutcome[],
  thresholds: Thresholds,
): GraderAggregate[] {
  return CASE_GRADERS.flatMap((grader) => {
    const scored = outcomes.filter((outcome) => grader.id in outcome.graders);
    if (scored.length === 0) return [];

    const scores = scored.map((outcome) => outcome.graders[grader.id]?.score ?? 0);
    const threshold = thresholds.graders[grader.id] ?? 0;
    const average = mean(scores);
    return [
      {
        graderId: grader.id,
        mean: average,
        min: Math.min(...scores),
        cases: scored.length,
        failedCases: scored
          .filter((outcome) => outcome.graders[grader.id]?.passed !== true)
          .map((outcome) => outcome.caseId),
        threshold,
        passed: average + Number.EPSILON >= threshold,
      },
    ];
  });
}

function computeTotals(outcomes: readonly CaseOutcome[]): RunTotals {
  const measurable = outcomes.filter((outcome) => outcome.transportError === null);
  const latencies = measurable.map((outcome) => outcome.latencyMs);
  const costUsd = outcomes.reduce((total, outcome) => total + outcome.costUsd, 0);
  const passedCases = outcomes.filter((outcome) => outcome.passed).length;

  return {
    cases: outcomes.length,
    passedCases,
    passRate: outcomes.length === 0 ? 0 : passedCases / outcomes.length,
    inputTokens: outcomes.reduce((total, outcome) => total + outcome.usage.input_tokens, 0),
    outputTokens: outcomes.reduce((total, outcome) => total + outcome.usage.output_tokens, 0),
    costUsd,
    costPerSpriteUsd: measurable.length === 0 ? 0 : costUsd / measurable.length,
    latencyP50Ms: percentile(latencies, 50),
    latencyP95Ms: percentile(latencies, 95),
  };
}

export interface RunEvalsOptions {
  cases: readonly EvalCase[];
  thresholds: Thresholds;
  model: ModelId;
  source: ResponseSource;
  concurrency: number;
  /** Inyectable para que los tests produzcan informes byte a byte comparables. */
  now?: () => Date;
}

/**
 * Ejecuta la suite y devuelve el informe. No escribe ficheros, no imprime y no toca
 * `process.exitCode`: eso es trabajo de `report.ts` y `main.ts`, y separarlo es lo que permite
 * testear la corrida entera sin ensuciar el disco.
 */
export async function runEvals(options: RunEvalsOptions): Promise<RunReport> {
  const outcomes = await mapWithConcurrency(options.cases, options.concurrency, (evalCase) =>
    runCase(evalCase, options.model, options.source),
  );

  const casesById = new Map(options.cases.map((evalCase) => [evalCase.id, evalCase]));
  const graders = aggregateGraders(outcomes, options.thresholds);

  const runGraders = RUN_GRADERS.flatMap((grader) => {
    const result = grader.grade({
      outcomes,
      budgets: options.thresholds.budgets,
      casesById,
    });
    return result === null ? [] : [{ graderId: grader.id, ...result }];
  });

  const totals = computeTotals(outcomes);
  const failures: string[] = [];

  for (const outcome of outcomes) {
    if (outcome.transportError !== null) {
      failures.push(`${outcome.caseId}: fallo de transporte — ${outcome.transportError}`);
    }
  }
  for (const aggregate of graders) {
    if (!aggregate.passed) {
      failures.push(
        `${aggregate.graderId}: media ${aggregate.mean.toFixed(3)} < umbral ` +
          `${aggregate.threshold.toFixed(3)} (falla en: ${aggregate.failedCases.join(", ")})`,
      );
    }
  }
  for (const result of runGraders) {
    const floor = options.thresholds.graders[result.graderId];
    const belowFloor = floor !== undefined && result.score + Number.EPSILON < floor;
    if (!result.passed || belowFloor) {
      failures.push(`${result.graderId}: ${result.detail}`);
    }
  }
  if (totals.passRate + Number.EPSILON < options.thresholds.minCasePassRate) {
    failures.push(
      `tasa de casos en verde ${(100 * totals.passRate).toFixed(1)}% < mínimo ` +
        `${(100 * options.thresholds.minCasePassRate).toFixed(1)}%`,
    );
  }

  const now = options.now ?? (() => new Date());
  return {
    reportVersion: REPORT_VERSION,
    generatedAt: now().toISOString(),
    source: options.source.kind,
    model: options.model,
    specSchemaVersion: SPRITE_SPEC_SCHEMA_VERSION,
    totals,
    cases: outcomes,
    graders,
    runGraders,
    failures,
    regressions: [],
  };
}
