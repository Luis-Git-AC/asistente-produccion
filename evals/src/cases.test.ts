import { describe, expect, it } from "vitest";
import { EvalCaseSchema, filterCases, loadCases } from "./cases.js";

const cases = loadCases();

describe("set de casos", () => {
  it("tiene al menos los 12 casos que exige la fase", () => {
    expect(cases.length).toBeGreaterThanOrEqual(12);
  });

  it("todos los casos validan y tienen id único", () => {
    for (const evalCase of cases) {
      expect(EvalCaseSchema.safeParse(evalCase).success).toBe(true);
    }
    expect(new Set(cases.map((c) => c.id)).size).toBe(cases.length);
  });

  /**
   * La cobertura es parte del contrato de la fase: un set de doce casos que sean doce sprites
   * estáticos de 16x16 no mide nada que no midiera el primero.
   */
  it("cubre los ejes que la fase exige medir", () => {
    const has = (predicate: (c: (typeof cases)[number]) => boolean): boolean =>
      cases.some(predicate);

    expect(has((c) => c.expectations.kind === "tileset")).toBe(true);
    expect(has((c) => (c.expectations.frames?.min ?? 0) >= 4)).toBe(true);
    expect(has((c) => c.expectations.palette?.exact !== undefined)).toBe(true);
    expect(
      has((c) => c.expectations.canvas === undefined && c.expectations.canvasMax !== undefined),
    ).toBe(true);
    expect(has((c) => c.expectations.equivalentTo !== undefined)).toBe(true);
    expect(has((c) => c.expectations.tagDirections !== undefined)).toBe(true);
    expect(has((c) => c.expectations.distinctFrameDurations === true)).toBe(true);
    expect(has((c) => c.prompt.length > 400)).toBe(true);
  });

  it("los pares de idioma se referencian en los dos sentidos", () => {
    const byId = new Map(cases.map((c) => [c.id, c]));
    for (const evalCase of cases) {
      const counterpartId = evalCase.expectations.equivalentTo;
      if (counterpartId === undefined) continue;
      const counterpart = byId.get(counterpartId);
      expect(counterpart, `${evalCase.id} apunta a ${counterpartId}`).toBeDefined();
      expect(counterpart?.expectations.equivalentTo).toBe(evalCase.id);
    }
  });
});

describe("filterCases", () => {
  it("sin ids devuelve todo el set", () => {
    expect(filterCases(cases, [])).toHaveLength(cases.length);
  });

  it("filtra por id", () => {
    const first = cases[0];
    expect(first).toBeDefined();
    expect(filterCases(cases, [first?.id ?? ""])).toHaveLength(1);
  });

  it("un id inexistente es un error, no un filtro vacío", () => {
    expect(() => filterCases(cases, ["no-existe"])).toThrow(/no-existe/u);
  });
});
