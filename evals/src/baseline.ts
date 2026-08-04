import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { z } from "zod";
import { BASELINE_PATH } from "./paths.js";
import type { RunReport } from "./types.js";

/**
 * La baseline es la foto de la última corrida bendecida. Sirve para responder a una pregunta
 * que el umbral no responde: "¿esto ha empeorado?".
 *
 * Un umbral sólo dice si estamos por encima de la línea; una media que cae de 0.99 a 0.92
 * sigue pasando un umbral de 0.9 y sin embargo es exactamente la señal que interesa ver. Por
 * eso las regresiones se **marcan** pero no deciden el código de salida: quien decide si algo
 * rompe el build es el umbral, que está versionado y se cambia a propósito.
 */

const TOLERANCE = 0.005;

const BaselineSchema = z
  .object({
    baselineVersion: z.string().min(1),
    recordedAt: z.string().min(1),
    model: z.string().min(1),
    source: z.enum(["fixtures", "live"]),
    notes: z.string().optional(),
    graders: z.record(z.string(), z.number()),
    runGraders: z.record(z.string(), z.number()),
    totals: z
      .object({
        passRate: z.number(),
        costPerSpriteUsd: z.number(),
        latencyP95Ms: z.number(),
      })
      .strict(),
  })
  .strict();

export type Baseline = z.infer<typeof BaselineSchema>;

export const BASELINE_VERSION = "1.0.0";

export function loadBaseline(path: string = BASELINE_PATH): Baseline | null {
  if (!existsSync(path)) return null;
  const parsed = BaselineSchema.safeParse(JSON.parse(readFileSync(path, "utf8")));
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<raíz>"}: ${issue.message}`)
      .join("; ");
    throw new Error(`baseline.json inválido: ${issues}`);
  }
  return parsed.data;
}

export function buildBaseline(report: RunReport, notes?: string): Baseline {
  return {
    baselineVersion: BASELINE_VERSION,
    recordedAt: report.generatedAt,
    model: report.model,
    source: report.source,
    ...(notes === undefined ? {} : { notes }),
    graders: Object.fromEntries(
      report.graders.map((aggregate) => [aggregate.graderId, Number(aggregate.mean.toFixed(4))]),
    ),
    runGraders: Object.fromEntries(
      report.runGraders.map((result) => [result.graderId, Number(result.score.toFixed(4))]),
    ),
    totals: {
      passRate: Number(report.totals.passRate.toFixed(4)),
      costPerSpriteUsd: Number(report.totals.costPerSpriteUsd.toFixed(6)),
      latencyP95Ms: Math.round(report.totals.latencyP95Ms),
    },
  };
}

/** Compara la corrida contra la baseline y devuelve las regresiones en lenguaje llano. */
export function compareToBaseline(report: RunReport, baseline: Baseline | null): string[] {
  if (baseline === null) return [];
  const regressions: string[] = [];

  for (const aggregate of report.graders) {
    const previous = baseline.graders[aggregate.graderId];
    if (previous === undefined) {
      regressions.push(`${aggregate.graderId}: grader nuevo, no estaba en la baseline`);
      continue;
    }
    if (aggregate.mean + TOLERANCE < previous) {
      regressions.push(
        `${aggregate.graderId}: ${previous.toFixed(3)} → ${aggregate.mean.toFixed(3)}`,
      );
    }
  }

  for (const result of report.runGraders) {
    const previous = baseline.runGraders[result.graderId];
    if (previous !== undefined && result.score + TOLERANCE < previous) {
      regressions.push(`${result.graderId}: ${previous.toFixed(3)} → ${result.score.toFixed(3)}`);
    }
  }

  if (report.totals.passRate + TOLERANCE < baseline.totals.passRate) {
    regressions.push(
      `tasa de casos en verde: ${(100 * baseline.totals.passRate).toFixed(1)}% → ` +
        `${(100 * report.totals.passRate).toFixed(1)}%`,
    );
  }

  // El coste sólo se compara en corridas en vivo: en `--fixtures` los tokens son los grabados,
  // así que un cambio de coste ahí significa "se regrabó el fixture", no "el sistema empeoró".
  if (report.source === "live" && baseline.source === "live") {
    const previous = baseline.totals.costPerSpriteUsd;
    if (previous > 0 && report.totals.costPerSpriteUsd > previous * 1.1) {
      regressions.push(
        `coste por sprite: $${previous.toFixed(4)} → $${report.totals.costPerSpriteUsd.toFixed(4)}`,
      );
    }
  }

  return regressions;
}

export function writeBaseline(baseline: Baseline, path: string = BASELINE_PATH): void {
  writeFileSync(path, `${JSON.stringify(baseline, null, 2)}\n`, "utf8");
}
