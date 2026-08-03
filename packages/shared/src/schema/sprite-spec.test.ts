import { describe, expect, it } from "vitest";
import { EXAMPLE_SPRITE_SPEC, SpriteSpecSchema, type SpriteSpec } from "./sprite-spec.js";

function clone(spec: SpriteSpec): SpriteSpec {
  return JSON.parse(JSON.stringify(spec)) as SpriteSpec;
}

describe("SpriteSpecSchema", () => {
  it("parsea el fixture EXAMPLE_SPRITE_SPEC", () => {
    const result = SpriteSpecSchema.safeParse(EXAMPLE_SPRITE_SPEC);
    expect(result.success).toBe(true);
  });

  it("rechaza schemaVersion distinto de la constante literal", () => {
    const spec = { ...clone(EXAMPLE_SPRITE_SPEC), schemaVersion: "9.9.9" };
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza un name que no es slug", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.name = "Not A Slug!";
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza canvas.width que no es potencia de 2 ni múltiplo de 8", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.canvas.width = 13;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("acepta canvas múltiplo de 8 que no es potencia de 2", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.canvas.width = 24;
    spec.canvas.height = 24;
    spec.frames[0]!.pixels = Array.from({ length: 24 }, () => ".".repeat(24));
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("rechaza una paleta vacía", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.palette = [];
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza un hex de paleta mal formado", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.palette[0]!.hex = "not-a-color";
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza tokens de paleta duplicados", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.palette[1]!.token = spec.palette[0]!.token;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza un token de paleta igual al carácter transparente", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.palette[0]!.token = ".";
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza valueStructure fuera de rango", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.shapeLanguage.valueStructure = 99;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza un frame cuyo index no coincide con su posición", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.index = 5;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza filas de pixel-map con longitud desigual al canvas", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.pixels[0] = ".";
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza un índice de paleta inexistente en el pixel-map", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.pixels[0] = "zzzzzzzz";
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza durationMs fuera de rango", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames[0]!.durationMs = 999_999;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza un tag fuera de rango de frames", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.tags[0]!.to = 7;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza nombres de tag duplicados", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.tags.push({ name: "idle", from: 0, to: 0, direction: "reverse" });
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("rechaza tags que se solapan de forma ambigua", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames.push({ index: 1, durationMs: 100, pixels: spec.frames[0]!.pixels });
    spec.tags = [
      { name: "idle", from: 0, to: 1, direction: "forward" },
      { name: "blink", from: 0, to: 0, direction: "forward" },
    ];
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });

  it("acepta tags con rangos disjuntos", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames.push({ index: 1, durationMs: 100, pixels: spec.frames[0]!.pixels });
    spec.tags = [
      { name: "idle", from: 0, to: 0, direction: "forward" },
      { name: "blink", from: 1, to: 1, direction: "forward" },
    ];
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(true);
  });

  it("rechaza export.padding fuera de rango", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.export.padding = -1;
    expect(SpriteSpecSchema.safeParse(spec).success).toBe(false);
  });
});
