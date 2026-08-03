import { EXAMPLE_SPRITE_SPEC, SPRITE_SPEC_SCHEMA_VERSION } from "@asistente/shared";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildCacheKey,
  normalizePrompt,
  ResponseCache,
  type CacheKeyParts,
} from "./response-cache.js";

const baseParts: CacheKeyParts = {
  prompt: "un icono de gema 8x8",
  schemaVersion: SPRITE_SPEC_SCHEMA_VERSION,
  model: "claude-opus-5",
  systemPrompt: "system prompt estable",
};

const openCaches: ResponseCache[] = [];

function makeCache(options: ConstructorParameters<typeof ResponseCache>[0] = {}): ResponseCache {
  const cache = new ResponseCache(options);
  openCaches.push(cache);
  return cache;
}

afterEach(() => {
  while (openCaches.length > 0) openCaches.pop()?.close();
});

describe("normalizePrompt", () => {
  it("colapsa espacios, recorta y baja a minúsculas", () => {
    expect(normalizePrompt("  Un  ICONO\n de\tgema  ")).toBe("un icono de gema");
  });
});

describe("buildCacheKey", () => {
  it("es estable para las mismas partes", () => {
    expect(buildCacheKey(baseParts)).toBe(buildCacheKey({ ...baseParts }));
  });

  it("ignora diferencias de espaciado y capitalización en el prompt", () => {
    expect(buildCacheKey({ ...baseParts, prompt: "  UN ICONO   DE GEMA 8X8 " })).toBe(
      buildCacheKey({ ...baseParts, prompt: "un icono de gema 8x8" }),
    );
  });

  it("cambia con el schemaVersion", () => {
    expect(buildCacheKey({ ...baseParts, schemaVersion: "2.0.0" })).not.toBe(
      buildCacheKey(baseParts),
    );
  });

  it("cambia con el modelo", () => {
    expect(buildCacheKey({ ...baseParts, model: "claude-sonnet-5" })).not.toBe(
      buildCacheKey(baseParts),
    );
  });

  it("cambia con el system prompt", () => {
    expect(buildCacheKey({ ...baseParts, systemPrompt: "otro prompt" })).not.toBe(
      buildCacheKey(baseParts),
    );
  });
});

describe("ResponseCache", () => {
  it("una clave desconocida es un miss", () => {
    expect(makeCache().lookup(baseParts)).toEqual({ hit: false });
  });

  it("guarda y recupera un spec con su metadata", () => {
    const cache = makeCache();
    cache.store({ ...baseParts, spec: EXAMPLE_SPRITE_SPEC, inputTokens: 111, outputTokens: 222 });

    const result = cache.lookup(baseParts);

    expect(result.hit).toBe(true);
    if (!result.hit) throw new Error("se esperaba un hit");
    expect(result.spec).toEqual(EXAMPLE_SPRITE_SPEC);
    expect(result.source).toBe("sqlite");
    expect(result.metadata).toMatchObject({
      model: "claude-opus-5",
      inputTokens: 111,
      outputTokens: 222,
    });
  });

  it("cambiar el schemaVersion invalida la entrada", () => {
    const cache = makeCache();
    cache.store({ ...baseParts, spec: EXAMPLE_SPRITE_SPEC, inputTokens: 1, outputTokens: 1 });

    expect(cache.lookup(baseParts).hit).toBe(true);
    expect(cache.lookup({ ...baseParts, schemaVersion: "2.0.0" }).hit).toBe(false);
  });

  it("cambiar el system prompt invalida la entrada", () => {
    const cache = makeCache();
    cache.store({ ...baseParts, spec: EXAMPLE_SPRITE_SPEC, inputTokens: 1, outputTokens: 1 });

    expect(cache.lookup({ ...baseParts, systemPrompt: "prompt v2" }).hit).toBe(false);
  });

  it("una entrada caducada es un miss", () => {
    let clock = 1_000_000;
    const cache = makeCache({ ttlSeconds: 60, now: () => clock });
    cache.store({ ...baseParts, spec: EXAMPLE_SPRITE_SPEC, inputTokens: 1, outputTokens: 1 });

    clock += 59_000;
    expect(cache.lookup(baseParts).hit).toBe(true);

    clock += 2_000; // total 61s > TTL
    expect(cache.lookup(baseParts).hit).toBe(false);
  });

  it("sobrescribir la misma clave actualiza el spec", () => {
    const cache = makeCache();
    cache.store({ ...baseParts, spec: EXAMPLE_SPRITE_SPEC, inputTokens: 1, outputTokens: 1 });

    const renamed = { ...EXAMPLE_SPRITE_SPEC, name: "gem-icon-v2" };
    cache.store({ ...baseParts, spec: renamed, inputTokens: 5, outputTokens: 6 });

    const result = cache.lookup(baseParts);
    if (!result.hit) throw new Error("se esperaba un hit");
    expect(result.spec.name).toBe("gem-icon-v2");
    expect(result.metadata.inputTokens).toBe(5);
  });

  it("purgeOtherSchemaVersions borra sólo las entradas de otras versiones", () => {
    const cache = makeCache();
    cache.store({ ...baseParts, spec: EXAMPLE_SPRITE_SPEC, inputTokens: 1, outputTokens: 1 });
    cache.store({
      ...baseParts,
      schemaVersion: "0.9.0",
      spec: EXAMPLE_SPRITE_SPEC,
      inputTokens: 1,
      outputTokens: 1,
    });

    expect(cache.purgeOtherSchemaVersions(SPRITE_SPEC_SCHEMA_VERSION)).toBe(1);
    expect(cache.lookup(baseParts).hit).toBe(true);
  });
});
