import { EXAMPLE_SPRITE_SPEC, assertStructuredOutputCompatible } from "@asistente/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseCache } from "../cache/response-cache.js";
import { generateSpriteSpec } from "./generate.js";
import { fakePort, httpError, instantRetry, specResponse, TEST_CHAIN } from "./test-support.js";
import { LlmRefusalError, SpecValidationError } from "./types.js";

const openCaches: ResponseCache[] = [];

function makeCache(): ResponseCache {
  const cache = new ResponseCache();
  openCaches.push(cache);
  return cache;
}

afterEach(() => {
  while (openCaches.length > 0) openCaches.pop()?.close();
});

const baseOptions = {
  prompt: "un icono de gema 8x8",
  chain: TEST_CHAIN,
  retry: instantRetry,
} as const;

describe("generateSpriteSpec", () => {
  it("devuelve un spec validado con métricas de la petición", async () => {
    const port = fakePort([specResponse()]);

    const result = await generateSpriteSpec({ ...baseOptions, port });

    expect(result.spec).toEqual(EXAMPLE_SPRITE_SPEC);
    expect(result.model).toBe("claude-opus-5");
    expect(result.cache).toBe("miss");
    expect(result.fellBack).toBe(false);
    expect(result.attempts).toBe(1);
    expect(result.usage.input_tokens).toBeGreaterThan(0);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("envía un JSON Schema compatible con structured outputs y sin $schema", async () => {
    const port = fakePort([specResponse()]);

    await generateSpriteSpec({ ...baseOptions, port });

    const sent = port.calls[0]?.jsonSchema;
    expect(sent).toBeDefined();
    expect(sent).not.toHaveProperty("$schema");
    expect(() => assertStructuredOutputCompatible(sent)).not.toThrow();
  });

  it("manda el system prompt aparte del prompt del usuario, para no invalidar el prefijo cacheado", async () => {
    const port = fakePort([specResponse()]);

    await generateSpriteSpec({ ...baseOptions, port });

    const call = port.calls[0];
    expect(call?.userPrompt).toBe(baseOptions.prompt);
    expect(call?.systemPrompt).not.toContain(baseOptions.prompt);
    expect(call?.maxTokens).toBeGreaterThanOrEqual(32_000);
  });

  it("dos llamadas idénticas: la segunda es cache hit y NO llama al SDK", async () => {
    const cache = makeCache();
    const port = fakePort([specResponse()]);

    const first = await generateSpriteSpec({ ...baseOptions, port, cache });
    expect(first.cache).toBe("miss");
    expect(port.calls).toHaveLength(1);

    const second = await generateSpriteSpec({ ...baseOptions, port, cache });

    expect(second.cache).toBe("hit");
    expect(second.spec).toEqual(first.spec);
    expect(port.calls).toHaveLength(1); // cero llamadas nuevas al SDK
    expect(second.attempts).toBe(0);
    expect(second.usage).toEqual({
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    });
  });

  it("un system prompt distinto invalida la caché y vuelve a llamar al SDK", async () => {
    const cache = makeCache();
    const port = fakePort([specResponse()]);

    await generateSpriteSpec({ ...baseOptions, port, cache });
    await generateSpriteSpec({ ...baseOptions, port, cache, systemPrompt: "prompt v2" });

    expect(port.calls).toHaveLength(2);
  });

  it("un spec inválido se rechaza con SpecValidationError y no se cachea", async () => {
    const cache = makeCache();
    // Forma correcta según JSON Schema, pero rompe un invariante cruzado: el tag apunta a un
    // frame que no existe. Esto es exactamente lo que structured outputs no puede garantizar.
    const invalid = {
      ...EXAMPLE_SPRITE_SPEC,
      tags: [{ name: "idle", from: 0, to: 99, direction: "forward" }],
    };
    const port = fakePort([specResponse(undefined, { text: JSON.stringify(invalid) })]);

    await expect(generateSpriteSpec({ ...baseOptions, port, cache })).rejects.toBeInstanceOf(
      SpecValidationError,
    );

    expect(cache.lookup({
      prompt: baseOptions.prompt,
      schemaVersion: EXAMPLE_SPRITE_SPEC.schemaVersion,
      model: "claude-opus-5",
      systemPrompt: (await import("./prompts/sprite-spec-system.js")).SPRITE_SPEC_SYSTEM_PROMPT,
    }).hit).toBe(false);
  });

  it("una respuesta que no es JSON da SpecValidationError, no un SyntaxError suelto", async () => {
    const port = fakePort([specResponse(undefined, { text: "lo siento, no puedo" })]);

    await expect(generateSpriteSpec({ ...baseOptions, port })).rejects.toBeInstanceOf(
      SpecValidationError,
    );
  });

  it("tolera que el modelo envuelva el JSON en un bloque de código", async () => {
    const fenced = "```json\n" + JSON.stringify(EXAMPLE_SPRITE_SPEC) + "\n```";
    const port = fakePort([specResponse(undefined, { text: fenced })]);

    const result = await generateSpriteSpec({ ...baseOptions, port });

    expect(result.spec).toEqual(EXAMPLE_SPRITE_SPEC);
  });

  it("propaga el refusal como error tipado", async () => {
    const port = fakePort([new LlmRefusalError("claude-opus-5", "cyber", "declinado")]);

    await expect(generateSpriteSpec({ ...baseOptions, port })).rejects.toBeInstanceOf(
      LlmRefusalError,
    );
  });

  it("registra el fallback de modelo en el resultado", async () => {
    const port = fakePort([
      httpError(529),
      httpError(529),
      httpError(529),
      specResponse(undefined, { servedByModel: "claude-sonnet-5" }),
    ]);

    const result = await generateSpriteSpec({ ...baseOptions, port });

    expect(result.model).toBe("claude-sonnet-5");
    expect(result.fellBack).toBe(true);
    expect(result.attempts).toBe(4);
  });

  it("reenvía los callbacks de streaming al puerto", async () => {
    const onTextDelta = vi.fn();
    const onThinkingStart = vi.fn();
    const port = fakePort([
      (request) => {
        request.onThinkingStart?.();
        request.onTextDelta?.('{"partial":');
        return specResponse();
      },
    ]);

    await generateSpriteSpec({ ...baseOptions, port, onTextDelta, onThinkingStart });

    expect(onThinkingStart).toHaveBeenCalledTimes(1);
    expect(onTextDelta).toHaveBeenCalledWith('{"partial":');
  });
});
