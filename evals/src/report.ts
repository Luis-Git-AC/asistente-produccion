import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { REPORTS_DIR } from "./paths.js";
import type { RunReport } from "./types.js";

/** Ancho fijo de la columna de id de caso/grader en la tabla de consola. */
const NAME_WIDTH = 30;

function pad(value: string, width: number): string {
  return value.length >= width ? value.slice(0, width - 1) + "…" : value.padEnd(width, " ");
}

function padStart(value: string, width: number): string {
  return value.padStart(width, " ");
}

function verdict(passed: boolean): string {
  return passed ? "PASS" : "FAIL";
}

function caseTable(report: RunReport): string[] {
  const graderIds = report.graders.map((aggregate) => aggregate.graderId);
  const header = [
    pad("caso", NAME_WIDTH),
    padStart("estado", 6),
    ...graderIds.map((id) => padStart(id.slice(0, 9), 10)),
    padStart("ms", 8),
    padStart("USD", 9),
  ].join(" ");

  const rows = report.cases.map((outcome) =>
    [
      pad(outcome.caseId, NAME_WIDTH),
      padStart(verdict(outcome.passed), 6),
      ...graderIds.map((id) => {
        const result = outcome.graders[id];
        return padStart(result === undefined ? "—" : result.score.toFixed(2), 10);
      }),
      padStart(outcome.latencyMs.toFixed(0), 8),
      padStart(outcome.costUsd.toFixed(4), 9),
    ].join(" "),
  );

  return [header, "-".repeat(header.length), ...rows];
}

function graderTable(report: RunReport): string[] {
  const header = [
    pad("grader", NAME_WIDTH),
    padStart("media", 8),
    padStart("min", 8),
    padStart("umbral", 8),
    padStart("casos", 6),
    padStart("estado", 7),
  ].join(" ");

  const rows = report.graders.map((aggregate) =>
    [
      pad(aggregate.graderId, NAME_WIDTH),
      padStart(aggregate.mean.toFixed(3), 8),
      padStart(aggregate.min.toFixed(3), 8),
      padStart(aggregate.threshold.toFixed(3), 8),
      padStart(String(aggregate.cases), 6),
      padStart(verdict(aggregate.passed), 7),
    ].join(" "),
  );

  return [header, "-".repeat(header.length), ...rows];
}

/** Sólo los detalles de lo que falla: un informe que lo cuenta todo no se lee. */
function failureDetails(report: RunReport): string[] {
  const lines: string[] = [];
  for (const outcome of report.cases) {
    const failed = Object.entries(outcome.graders).filter(([, result]) => !result.passed);
    if (failed.length === 0) continue;
    lines.push(`  ${outcome.caseId}`);
    for (const [graderId, result] of failed) {
      lines.push(`    ${graderId} (${result.score.toFixed(2)}): ${result.detail}`);
    }
  }
  return lines;
}

export function formatConsoleReport(report: RunReport): string {
  const lines: string[] = [];
  lines.push("");
  lines.push(
    `evals · ${report.source} · modelo ${report.model} · SpriteSpec v${report.specSchemaVersion}`,
  );
  lines.push("");
  lines.push(...caseTable(report));
  lines.push("");
  lines.push(...graderTable(report));

  if (report.runGraders.length > 0) {
    lines.push("");
    for (const result of report.runGraders) {
      lines.push(
        `${pad(result.graderId, NAME_WIDTH)} ${padStart(verdict(result.passed), 6)}  ${result.detail}`,
      );
    }
  }

  const details = failureDetails(report);
  if (details.length > 0) {
    lines.push("");
    lines.push("Detalle de lo que no pasa:");
    lines.push(...details);
  }

  if (report.regressions.length > 0) {
    lines.push("");
    lines.push("Regresiones respecto a baseline.json (no rompen el build):");
    for (const regression of report.regressions) lines.push(`  ${regression}`);
  }

  const { totals } = report;
  lines.push("");
  lines.push(
    `${String(totals.passedCases)}/${String(totals.cases)} casos en verde ` +
      `(${(100 * totals.passRate).toFixed(1)}%) · ` +
      `${String(totals.inputTokens)} tok in / ${String(totals.outputTokens)} tok out · ` +
      `$${totals.costUsd.toFixed(4)} total, $${totals.costPerSpriteUsd.toFixed(4)}/sprite · ` +
      `p50 ${totals.latencyP50Ms.toFixed(0)} ms, p95 ${totals.latencyP95Ms.toFixed(0)} ms`,
  );

  if (report.failures.length === 0) {
    lines.push("Todos los umbrales se cumplen.");
  } else {
    lines.push("");
    lines.push("UMBRALES INCUMPLIDOS:");
    for (const failure of report.failures) lines.push(`  ${failure}`);
  }
  lines.push("");

  return lines.join("\n");
}

/**
 * Nombre del informe. Aquí sí se usa la hora: el informe es un artefacto de una corrida
 * concreta, no una clave que tenga que resolver siempre igual (a diferencia de los fixtures).
 */
export function defaultReportPath(generatedAt: string): string {
  const stamp = generatedAt.replace(/[:.]/gu, "-");
  return join(REPORTS_DIR, `${stamp}.json`);
}

/**
 * El informe en disco lleva un RESUMEN del spec, no el spec entero: los pixel-maps de trece
 * casos son ~65 KB de filas de texto que nadie va a leer y que el fixture ya guarda íntegros.
 * Un informe que hay que abrir con un visor de JSON deja de usarse a la tercera vez.
 */
function toSerializable(report: RunReport): unknown {
  return {
    ...report,
    cases: report.cases.map((outcome) => {
      const { spec, ...rest } = outcome;
      return {
        ...rest,
        spec:
          spec === null
            ? null
            : {
                name: spec.name,
                kind: spec.kind,
                canvas: spec.canvas,
                paletteSize: spec.palette.length,
                frameCount: spec.frames.length,
                tags: spec.tags.map(
                  (tag) => `${tag.name}[${String(tag.from)},${String(tag.to)}] ${tag.direction}`,
                ),
              },
      };
    }),
  };
}

export function writeReport(report: RunReport, path: string): string {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(toSerializable(report), null, 2)}\n`, "utf8");
  return path;
}
