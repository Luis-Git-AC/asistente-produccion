import { MODEL_IDS } from "@asistente/shared";
import { describe, expect, it } from "vitest";
import { CliError, DEFAULT_CONCURRENCY, parseCliArgs } from "./cli.js";
import { ALL_GRADER_IDS } from "./graders/index.js";
import { loadThresholds } from "./thresholds.js";

describe("parseCliArgs", () => {
  it("sin flags corre en vivo con el modelo por defecto", () => {
    const options = parseCliArgs([]);
    expect(options).toMatchObject({
      fixtures: false,
      record: false,
      model: MODEL_IDS[0],
      concurrency: DEFAULT_CONCURRENCY,
    });
  });

  it("acepta --case repetido", () => {
    expect(parseCliArgs(["--case", "a", "--case", "b"]).caseIds).toEqual(["a", "b"]);
  });

  /** Grabar exige llamar a la API: creer que se está grabando sin hacerlo es un fallo caro. */
  it("--fixtures y --record son incompatibles", () => {
    expect(() => parseCliArgs(["--fixtures", "--record"])).toThrow(CliError);
  });

  it("rechaza un modelo desconocido", () => {
    expect(() => parseCliArgs(["--model", "gpt-de-mentira"])).toThrow(/modelo desconocido/u);
  });

  it("rechaza una concurrencia que no es un entero positivo", () => {
    expect(() => parseCliArgs(["--concurrency", "0"])).toThrow(CliError);
    expect(() => parseCliArgs(["--concurrency", "dos"])).toThrow(CliError);
  });

  it("rechaza flags desconocidos en vez de ignorarlos", () => {
    expect(() => parseCliArgs(["--fixtres"])).toThrow(CliError);
  });
});

describe("thresholds.json", () => {
  it("declara un umbral por cada grader del registro", () => {
    const thresholds = loadThresholds();
    for (const graderId of ALL_GRADER_IDS) {
      // Los graders de presupuesto se rigen por `budgets`, no por una media.
      if (graderId === "latency-budget" || graderId === "cost-budget") continue;
      expect(thresholds.graders[graderId], graderId).toBeDefined();
    }
  });

  it("los presupuestos son positivos", () => {
    const { budgets } = loadThresholds();
    expect(budgets.latencyP95Ms).toBeGreaterThan(0);
    expect(budgets.costPerSpriteUsd).toBeGreaterThan(0);
  });
});
