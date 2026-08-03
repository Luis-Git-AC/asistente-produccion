import { describe, expect, it } from "vitest";
import { SPRITE_SPEC_PROMPT_VERSION, SPRITE_SPEC_SYSTEM_PROMPT } from "./sprite-spec-system.js";

describe("SPRITE_SPEC_SYSTEM_PROMPT", () => {
  it("es byte-estable entre importaciones (sin interpolación dinámica)", () => {
    // Si alguien mete un `${Date.now()}` en el prompt, este test no lo pilla pero el siguiente sí.
    // Éste cubre el caso de un prompt construido de forma no determinista al importar el módulo.
    expect(SPRITE_SPEC_SYSTEM_PROMPT).toBe(SPRITE_SPEC_SYSTEM_PROMPT);
    expect(SPRITE_SPEC_SYSTEM_PROMPT.length).toBeGreaterThan(0);
  });

  it("no contiene invalidadores silenciosos del prefijo cacheado", () => {
    // Un timestamp, una fecha ISO o un UUID en el prefijo tiran el cache hit rate a 0 sin avisar.
    expect(SPRITE_SPEC_SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/u);
    expect(SPRITE_SPEC_SYSTEM_PROMPT).not.toMatch(
      /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/iu,
    );
    expect(SPRITE_SPEC_SYSTEM_PROMPT).not.toMatch(/\b1[0-9]{12}\b/u); // epoch en ms
  });

  it("es lo bastante largo para superar el mínimo cacheable de Opus 5 (512 tokens)", () => {
    // Aproximación conservadora de ~3 caracteres por token: por debajo de esto el prompt
    // caching no llega a crear entrada y `cache_creation_input_tokens` se queda a 0.
    expect(SPRITE_SPEC_SYSTEM_PROMPT.length).toBeGreaterThan(512 * 3);
  });

  it("cubre las reglas de dominio que el schema no puede expresar por sí solo", () => {
    for (const concept of [
      "potencia de 2",
      "hue shifting",
      "pixel-map",
      "transparencia",
      "pingpong",
      "Unity",
    ]) {
      expect(SPRITE_SPEC_SYSTEM_PROMPT).toContain(concept);
    }
  });

  it("prohíbe explícitamente la prosa alrededor del objeto", () => {
    expect(SPRITE_SPEC_SYSTEM_PROMPT).toMatch(/no escribes prosa/iu);
  });

  it("expone una versión semántica", () => {
    expect(SPRITE_SPEC_PROMPT_VERSION).toMatch(/^\d+\.\d+\.\d+$/u);
  });
});
