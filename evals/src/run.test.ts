import { MODEL_IDS } from "@asistente/shared";
import { describe, expect, it } from "vitest";
import { buildBaseline, compareToBaseline } from "./baseline.js";
import { filterCases, loadCases } from "./cases.js";
import { fixtureSource } from "./response-source.js";
import { runEvals } from "./run.js";
import { loadThresholds } from "./thresholds.js";
import type { Thresholds } from "./types.js";

const cases = loadCases();
const thresholds = loadThresholds();
const MODEL = MODEL_IDS[0];

const NOW = (): Date => new Date("2026-08-04T00:00:00.000Z");

function run(overrides: { cases?: typeof cases; thresholds?: Thresholds } = {}) {
  return runEvals({
    cases: overrides.cases ?? cases,
    thresholds: overrides.thresholds ?? thresholds,
    model: MODEL,
    source: fixtureSource,
    concurrency: 4,
    now: NOW,
  });
}

describe("runEvals contra los fixtures", () => {
  it("corre el set entero y cumple todos los umbrales versionados", async () => {
    const report = await run();
    expect(report.cases).toHaveLength(cases.length);
    expect(report.failures, report.failures.join(" · ")).toHaveLength(0);
  });

  it("puntúa todos los graders de caso en todos los casos que les aplican", async () => {
    const report = await run();
    for (const aggregate of report.graders) {
      expect(aggregate.cases, aggregate.graderId).toBeGreaterThan(0);
    }
    expect(report.graders.map((g) => g.graderId)).toContain("lua-emits-single-transaction");
  });

  it("es determinista: dos corridas producen el mismo informe", async () => {
    const [first, second] = await Promise.all([run(), run()]);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  /**
   * El criterio de aceptación de la fase, automatizado: subir un umbral tiene que romper la
   * corrida. Si esto pasara en verde, la suite entera sería decorativa.
   */
  it("subir un umbral por encima de lo medido produce fallos", async () => {
    const green = await run();
    const observed = green.graders.find((g) => g.graderId === "frame-tag-coherence");
    expect(observed).toBeDefined();
    expect(observed?.mean).toBeLessThan(1);

    const stricter: Thresholds = {
      ...thresholds,
      graders: { ...thresholds.graders, "frame-tag-coherence": 1 },
    };
    const report = await run({ thresholds: stricter });
    expect(report.failures.join(" ")).toContain("frame-tag-coherence");
  });

  it("un presupuesto imposible rompe la corrida", async () => {
    const stricter: Thresholds = {
      ...thresholds,
      budgets: { latencyP95Ms: 1, costPerSpriteUsd: 0.0001 },
    };
    const report = await run({ thresholds: stricter });
    expect(report.failures.join(" ")).toContain("latency-budget");
    expect(report.failures.join(" ")).toContain("cost-budget");
  });

  it("--case ejecuta un solo caso sin inventarse los graders de par", async () => {
    const one = filterCases(cases, ["potion-icon-es"]);
    const report = await run({ cases: one });
    expect(report.cases).toHaveLength(1);
    expect(report.runGraders.map((g) => g.graderId)).not.toContain("cross-language-consistency");
  });

  it("el total de tokens y coste sale de las respuestas, no de un contador", async () => {
    const report = await run();
    const sum = report.cases.reduce((total, outcome) => total + outcome.usage.output_tokens, 0);
    expect(report.totals.outputTokens).toBe(sum);
    expect(report.totals.costUsd).toBeGreaterThan(0);
  });
});

describe("comparación contra baseline", () => {
  it("una corrida idéntica a su baseline no reporta regresiones", async () => {
    const report = await run();
    expect(compareToBaseline(report, buildBaseline(report))).toHaveLength(0);
  });

  it("marca la caída de un grader respecto a la baseline", async () => {
    const report = await run();
    const baseline = buildBaseline(report);
    baseline.graders["frame-tag-coherence"] = 1;

    const regressions = compareToBaseline(report, baseline);
    expect(regressions.join(" ")).toContain("frame-tag-coherence");
  });

  it("sin baseline no hay comparación ni error", async () => {
    const report = await run();
    expect(compareToBaseline(report, null)).toHaveLength(0);
  });
});
