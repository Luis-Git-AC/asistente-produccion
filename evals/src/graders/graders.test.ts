import { EXAMPLE_SPRITE_SPEC, type SpriteSpec } from "@asistente/shared";
import { emitGenerateSpriteLua } from "@asistente/mcp-aseprite";
import { describe, expect, it } from "vitest";
import type { EvalCase, Expectations } from "../cases.js";
import type { CaseGraderContext, CaseOutcome, EvalUsage } from "../types.js";
import { costBudgetGrader, latencyBudgetGrader } from "./budgets.js";
import { canvasConstraintGrader } from "./canvas-constraint.js";
import { crossLanguageConsistencyGrader } from "./cross-language.js";
import { frameTagCoherenceGrader } from "./frame-tag-coherence.js";
import { luaSingleTransactionGrader } from "./lua-single-transaction.js";
import { paletteConstraintGrader } from "./palette-constraint.js";
import { pixelMapIntegrityGrader } from "./pixel-map-integrity.js";
import { schemaValidGrader } from "./schema-valid.js";

/**
 * Cada grader se prueba contra un spec DEFECTUOSO construido a propósito. Un grader que sólo se
 * ha visto pasando no ha demostrado nada: la suite entera se apoya en que estos fallan cuando
 * toca, y ese es exactamente el comportamiento que los fixtures en verde no pueden ejercitar.
 */

const PATHS = {
  asepritePath: "/out/x.aseprite",
  spritesheetPath: "/out/x.png",
  jsonPath: "/out/x.json",
};

function clone(spec: SpriteSpec): SpriteSpec {
  return JSON.parse(JSON.stringify(spec)) as SpriteSpec;
}

function makeCase(expectations: Expectations): EvalCase {
  return { id: "caso-de-prueba", prompt: "da igual", expectations, tags: ["test"] };
}

function ctx(
  evalCase: EvalCase,
  spec: SpriteSpec | null,
  overrides: Partial<CaseGraderContext> = {},
): CaseGraderContext {
  return {
    evalCase,
    rawText: spec === null ? "" : JSON.stringify(spec),
    spec,
    issues: spec === null ? ["forzado en el test"] : [],
    lua: spec === null ? null : emitGenerateSpriteLua(spec, PATHS),
    ...overrides,
  };
}

describe("schema-valid", () => {
  it("puntúa 1 con un spec válido", () => {
    const result = schemaValidGrader.grade(ctx(makeCase({}), EXAMPLE_SPRITE_SPEC));
    expect(result).toMatchObject({ score: 1, passed: true });
  });

  it("puntúa 0 y explica el motivo sin spec", () => {
    const result = schemaValidGrader.grade(ctx(makeCase({}), null));
    expect(result.score).toBe(0);
    expect(result.detail).toContain("forzado en el test");
  });
});

describe("palette-constraint", () => {
  /**
   * `EXAMPLE_SPRITE_SPEC` declara cinco colores y sólo pinta tres — que es precisamente el
   * defecto que este grader busca —, así que las pruebas del camino feliz parten de una
   * variante en la que los cinco se ven.
   */
  function allColoursUsed(): SpriteSpec {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.pixels = [
      "...oo...",
      "..ohho..",
      ".ohbbho.",
      "ohsbbaho",
      "ohsbbaho",
      ".ohbbho.",
      "..ohho..",
      "...oo...",
    ];
    return spec;
  }

  it("no aplica si el caso no pide nada de paleta", () => {
    expect(paletteConstraintGrader.appliesTo(makeCase({}))).toBe(false);
  });

  it("pasa cuando el número exacto coincide y todos los colores se usan", () => {
    const evalCase = makeCase({ palette: { exact: 5 } });
    expect(paletteConstraintGrader.grade(ctx(evalCase, allColoursUsed())).passed).toBe(true);
  });

  it("puntúa por debajo de 1 al pasarse del máximo, y peor cuanto más se pasa", () => {
    const evalCase = makeCase({ palette: { max: 2 } });
    const pocoExceso = allColoursUsed();
    pocoExceso.palette = pocoExceso.palette.filter((entry) => "obs".includes(entry.token));
    pocoExceso.frames[0]!.pixels = pocoExceso.frames[0]!.pixels.map((row) =>
      row.replace(/[ha]/gu, "b"),
    );

    const cerca = paletteConstraintGrader.grade(ctx(evalCase, pocoExceso));
    const lejos = paletteConstraintGrader.grade(ctx(evalCase, allColoursUsed()));
    expect(cerca.passed).toBe(false);
    expect(lejos.score).toBeLessThan(cerca.score);
  });

  /** Declarar cinco colores y pintar con tres es la forma barata de "cumplir" la restricción. */
  it("detecta colores declarados que no pinta ningún píxel", () => {
    const evalCase = makeCase({ palette: { exact: 5 } });
    const conColorMuerto = allColoursUsed();
    conColorMuerto.frames[0]!.pixels = conColorMuerto.frames[0]!.pixels.map((row) =>
      row.replace(/a/gu, "b"),
    );

    const result = paletteConstraintGrader.grade(ctx(evalCase, conColorMuerto));
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(1);
    expect(result.detail).toContain("sin usar");
  });
});

describe("canvas-constraint", () => {
  it("da 1 al lienzo exacto", () => {
    const evalCase = makeCase({ canvas: { width: 8, height: 8 } });
    expect(canvasConstraintGrader.grade(ctx(evalCase, EXAMPLE_SPRITE_SPEC)).score).toBe(1);
  });

  it("da puntuación parcial a un lienzo distinto pero utilizable", () => {
    const evalCase = makeCase({
      canvas: { width: 16, height: 16 },
      canvasMax: { width: 32, height: 32 },
    });
    const result = canvasConstraintGrader.grade(ctx(evalCase, EXAMPLE_SPRITE_SPEC));
    expect(result.passed).toBe(false);
    expect(result.score).toBe(0.5);
    expect(result.detail).toContain("utilizable");
  });

  it("da 0 a un lienzo fuera de la cota", () => {
    const evalCase = makeCase({ canvasMax: { width: 4, height: 4 }, canvasMultipleOf: 8 });
    const result = canvasConstraintGrader.grade(ctx(evalCase, EXAMPLE_SPRITE_SPEC));
    expect(result.passed).toBe(false);
    expect(result.score).toBeLessThan(1);
  });
});

describe("frame-tag-coherence", () => {
  function twoFrameSpec(): SpriteSpec {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    const frame = spec.frames[0]!;
    spec.frames = [
      { ...frame, index: 0, durationMs: 100 },
      { ...frame, index: 1, durationMs: 100 },
    ];
    return spec;
  }

  it("penaliza un frame fuera de todos los tags", () => {
    const spec = twoFrameSpec();
    spec.tags = [{ name: "idle", from: 0, to: 0, direction: "forward" }];
    const evalCase = makeCase({ frames: { exact: 2 }, noOrphanFrames: true });

    const result = frameTagCoherenceGrader.grade(ctx(evalCase, spec));
    expect(result.passed).toBe(false);
    expect(result.score).toBeGreaterThan(0);
    expect(result.score).toBeLessThan(1);
    expect(result.detail).toContain("huérfanos");
  });

  it("detecta tags solapados", () => {
    const spec = twoFrameSpec();
    spec.tags = [
      { name: "a", from: 0, to: 1, direction: "forward" },
      { name: "b", from: 1, to: 1, direction: "forward" },
    ];
    const result = frameTagCoherenceGrader.grade(ctx(makeCase({ tags: { exact: 2 } }), spec));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("solape");
  });

  it("detecta que falta la dirección pedida", () => {
    const spec = twoFrameSpec();
    spec.tags = [{ name: "idle", from: 0, to: 1, direction: "forward" }];
    const result = frameTagCoherenceGrader.grade(
      ctx(makeCase({ tagDirections: ["pingpong"] }), spec),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("pingpong");
  });

  it("detecta una animación con todas las duraciones iguales", () => {
    const spec = twoFrameSpec();
    spec.tags = [{ name: "idle", from: 0, to: 1, direction: "forward" }];
    const result = frameTagCoherenceGrader.grade(
      ctx(makeCase({ distinctFrameDurations: true }), spec),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("duraciones");
  });
});

describe("pixel-map-integrity", () => {
  it("pasa con el spec de referencia", () => {
    expect(pixelMapIntegrityGrader.grade(ctx(makeCase({}), EXAMPLE_SPRITE_SPEC)).passed).toBe(true);
  });

  /** El spec sigue validando contra Zod: un lienzo vacío es sintácticamente perfecto. */
  it("detecta un frame completamente transparente", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.pixels = spec.frames[0]!.pixels.map(() => "........");
    const result = pixelMapIntegrityGrader.grade(ctx(makeCase({}), spec));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("transparentes");
  });

  it("detecta un lienzo por debajo de la cobertura mínima pedida", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.pixels = spec.frames[0]!.pixels.map((_row, index) =>
      index === 0 ? "b......." : "........",
    );
    const result = pixelMapIntegrityGrader.grade(ctx(makeCase({ minOpaqueRatio: 0.2 }), spec));
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("cobertura");
  });
});

describe("lua-emits-single-transaction", () => {
  it("pasa con el Lua que emite el emisor real", () => {
    const result = luaSingleTransactionGrader.grade(ctx(makeCase({}), EXAMPLE_SPRITE_SPEC));
    expect(result).toMatchObject({ score: 1, passed: true });
  });

  it("detecta dos transacciones", () => {
    const lua = 'app.transaction("a", function() end)\napp.transaction("b", function() end)\n';
    const result = luaSingleTransactionGrader.grade(
      ctx(makeCase({}), EXAMPLE_SPRITE_SPEC, { lua }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("2 transacción");
  });

  it("detecta un app.command que bloquearía la UI", () => {
    const lua =
      'app.transaction("a", function() end)\napp.command.ExportSpriteSheet{ trim = false }\n';
    const result = luaSingleTransactionGrader.grade(
      ctx(makeCase({}), EXAMPLE_SPRITE_SPEC, { lua }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("ui = false");
  });

  /** El fallo que ni el snapshot ni el test de sintaxis ven: sólo se nota abriendo el PNG. */
  it("detecta un color RGBA empaquetado", () => {
    const lua = 'app.transaction("a", function() end)\nlocal c = 0x3fa6c4ff\n';
    const result = luaSingleTransactionGrader.grade(
      ctx(makeCase({}), EXAMPLE_SPRITE_SPEC, { lua }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("empaquetado");
  });

  it("detecta Lua que no compila", () => {
    const lua = 'app.transaction("a", function() end)\nlocal = = =\n';
    const result = luaSingleTransactionGrader.grade(
      ctx(makeCase({}), EXAMPLE_SPRITE_SPEC, { lua }),
    );
    expect(result.passed).toBe(false);
    expect(result.detail).toContain("sintaxis");
  });
});

// ------------------------------------------------------------- graders de corrida

const USAGE: EvalUsage = {
  input_tokens: 100,
  output_tokens: 1000,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

function outcome(overrides: Partial<CaseOutcome> = {}): CaseOutcome {
  return {
    caseId: "caso",
    tags: ["test"],
    model: "claude-opus-5",
    source: "fixture",
    latencyMs: 1000,
    usage: USAGE,
    costUsd: 0.01,
    transportError: null,
    spec: EXAMPLE_SPRITE_SPEC,
    graders: {},
    passed: true,
    ...overrides,
  };
}

const BUDGETS = { latencyP95Ms: 5000, costPerSpriteUsd: 0.05 };

describe("presupuestos", () => {
  it("la latencia pasa bajo presupuesto y falla por encima", () => {
    const context = { casesById: new Map(), budgets: BUDGETS };
    expect(latencyBudgetGrader.grade({ ...context, outcomes: [outcome()] })?.passed).toBe(true);
    expect(
      latencyBudgetGrader.grade({ ...context, outcomes: [outcome({ latencyMs: 9000 })] })?.passed,
    ).toBe(false);
  });

  it("el coste pasa bajo presupuesto y falla por encima", () => {
    const context = { casesById: new Map(), budgets: BUDGETS };
    expect(costBudgetGrader.grade({ ...context, outcomes: [outcome()] })?.passed).toBe(true);
    expect(
      costBudgetGrader.grade({ ...context, outcomes: [outcome({ costUsd: 0.2 })] })?.passed,
    ).toBe(false);
  });

  /**
   * Un caso que falló por transporte tiene latencia y coste ~0: contarlo bajaría el p95 justo
   * cuando el sistema está peor.
   */
  it("los casos con fallo de transporte no entran en el percentil", () => {
    const outcomes = [
      outcome({ latencyMs: 9000 }),
      outcome({ caseId: "roto", latencyMs: 3, transportError: "ECONNRESET" }),
    ];
    const result = latencyBudgetGrader.grade({ outcomes, budgets: BUDGETS, casesById: new Map() });
    expect(result?.detail).toContain("1 caso(s)");
    expect(result?.passed).toBe(false);
  });

  it("sin casos medibles no se inventa una medida", () => {
    const outcomes = [outcome({ transportError: "boom" })];
    expect(
      latencyBudgetGrader.grade({ outcomes, budgets: BUDGETS, casesById: new Map() }),
    ).toBeNull();
  });
});

describe("cross-language-consistency", () => {
  const esCase = makeCase({ equivalentTo: "en" });
  const casesById = new Map<string, EvalCase>([
    ["es", { ...esCase, id: "es" }],
    ["en", { ...makeCase({ equivalentTo: "es" }), id: "en" }],
  ]);

  it("pasa cuando los dos specs coinciden", () => {
    const outcomes = [outcome({ caseId: "es" }), outcome({ caseId: "en" })];
    expect(
      crossLanguageConsistencyGrader.grade({ outcomes, budgets: BUDGETS, casesById })?.passed,
    ).toBe(true);
  });

  it("falla cuando el idioma cambia el lienzo", () => {
    const otro = clone(EXAMPLE_SPRITE_SPEC);
    otro.canvas = { width: 16, height: 16 };
    const outcomes = [outcome({ caseId: "es" }), outcome({ caseId: "en", spec: otro })];
    const result = crossLanguageConsistencyGrader.grade({ outcomes, budgets: BUDGETS, casesById });
    expect(result?.passed).toBe(false);
    expect(result?.detail).toContain("mismo lienzo");
  });

  it("devuelve null si el par no está completo en la corrida", () => {
    const outcomes = [outcome({ caseId: "es" })];
    expect(
      crossLanguageConsistencyGrader.grade({ outcomes, budgets: BUDGETS, casesById }),
    ).toBeNull();
  });
});
