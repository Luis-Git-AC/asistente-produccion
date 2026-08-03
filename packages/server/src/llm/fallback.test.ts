import { describe, expect, it, vi } from "vitest";
import type { SpecMessageRequest } from "./anthropic-port.js";
import {
  DEFAULT_MODEL_CHAIN,
  runWithModelFallback,
  simulate5xxEnabled,
  withSimulatedPrimaryFailure,
} from "./fallback.js";
import { fakePort, httpError, instantRetry, specResponse, TEST_CHAIN } from "./test-support.js";
import { LlmRefusalError, RetriesExhaustedError } from "./types.js";

const baseRequest: Omit<SpecMessageRequest, "model"> = {
  systemPrompt: "system",
  userPrompt: "un sprite de gema 8x8",
  jsonSchema: { type: "object" },
  maxTokens: 32_000,
  effort: "high",
};

describe("runWithModelFallback", () => {
  it("usa el primario y no cae al fallback cuando responde bien", async () => {
    const port = fakePort([specResponse()]);

    const result = await runWithModelFallback(port, baseRequest, {
      ...instantRetry,
      chain: TEST_CHAIN,
    });

    expect(result.model).toBe("claude-opus-5");
    expect(result.fellBack).toBe(false);
    expect(result.attempts).toBe(1);
    expect(port.calls).toHaveLength(1);
  });

  it("cae a claude-sonnet-5 cuando el primario agota los reintentos", async () => {
    // 3 fallos del primario (maxAttempts por defecto), luego el fallback responde.
    const port = fakePort([
      httpError(529),
      httpError(529),
      httpError(529),
      specResponse(undefined, { servedByModel: "claude-sonnet-5" }),
    ]);

    const result = await runWithModelFallback(port, baseRequest, {
      ...instantRetry,
      chain: TEST_CHAIN,
    });

    expect(result.model).toBe("claude-sonnet-5");
    expect(result.fellBack).toBe(true);
    expect(result.attempts).toBe(4);
    expect(port.calls.map((c) => c.model)).toEqual([
      "claude-opus-5",
      "claude-opus-5",
      "claude-opus-5",
      "claude-sonnet-5",
    ]);
  });

  it("avisa del salto de modelo por onModelFallback", async () => {
    const onModelFallback = vi.fn();
    const port = fakePort([
      httpError(529),
      httpError(529),
      httpError(529),
      specResponse(),
    ]);

    await runWithModelFallback(port, baseRequest, {
      ...instantRetry,
      chain: TEST_CHAIN,
      onModelFallback,
    });

    expect(onModelFallback).toHaveBeenCalledTimes(1);
    expect(onModelFallback.mock.calls[0]?.[0]).toMatchObject({
      from: "claude-opus-5",
      to: "claude-sonnet-5",
    });
  });

  it("un 400 aborta la cadena sin probar el fallback", async () => {
    const port = fakePort([httpError(400, "temperature no permitido")]);

    await expect(
      runWithModelFallback(port, baseRequest, { ...instantRetry, chain: TEST_CHAIN }),
    ).rejects.toMatchObject({ status: 400 });

    expect(port.calls).toHaveLength(1);
  });

  it("un refusal aborta la cadena: reintentar en otro modelo no lo arreglaría", async () => {
    const port = fakePort([new LlmRefusalError("claude-opus-5", "cyber", "declinado")]);

    await expect(
      runWithModelFallback(port, baseRequest, { ...instantRetry, chain: TEST_CHAIN }),
    ).rejects.toBeInstanceOf(LlmRefusalError);

    expect(port.calls).toHaveLength(1);
  });

  it("lanza RetriesExhaustedError cuando fallan todos los modelos de la cadena", async () => {
    const port = fakePort([httpError(529)]);

    await expect(
      runWithModelFallback(port, baseRequest, { ...instantRetry, chain: TEST_CHAIN }),
    ).rejects.toBeInstanceOf(RetriesExhaustedError);

    expect(port.calls).toHaveLength(6); // 3 intentos por cada uno de los 2 modelos
  });
});

describe("withSimulatedPrimaryFailure", () => {
  it("desactivado, deja pasar la petición sin tocarla", async () => {
    const port = fakePort([specResponse()]);
    const wrapped = withSimulatedPrimaryFailure(port, { enabled: false });

    await expect(
      wrapped.createSpecMessage({ ...baseRequest, model: "claude-opus-5" }),
    ).resolves.toMatchObject({ servedByModel: "claude-opus-5" });
  });

  it("activado, fuerza el fallback del primario al secundario", async () => {
    const port = fakePort([specResponse(undefined, { servedByModel: "claude-sonnet-5" })]);
    const wrapped = withSimulatedPrimaryFailure(port, { enabled: true });

    const result = await runWithModelFallback(wrapped, baseRequest, {
      ...instantRetry,
      chain: TEST_CHAIN,
    });

    expect(result.model).toBe("claude-sonnet-5");
    expect(result.fellBack).toBe(true);
    // El primario nunca llegó al puerto real: falló antes.
    expect(port.calls.every((call) => call.model === "claude-sonnet-5")).toBe(true);
  });

  it("el fallo simulado es reintentable, como un 529 real", async () => {
    const wrapped = withSimulatedPrimaryFailure(fakePort([specResponse()]), { enabled: true });

    await expect(
      wrapped.createSpecMessage({ ...baseRequest, model: "claude-opus-5" }),
    ).rejects.toMatchObject({ status: 529, code: "simulated_failure" });
  });
});

describe("simulate5xxEnabled", () => {
  it.each(["1", "true", "TRUE"])("está activo con %s", (value) => {
    expect(simulate5xxEnabled({ SIMULATE_5XX: value })).toBe(true);
  });

  it.each(["0", "false", "", undefined])("está inactivo con %s", (value) => {
    expect(simulate5xxEnabled(value === undefined ? {} : { SIMULATE_5XX: value })).toBe(false);
  });
});

describe("DEFAULT_MODEL_CHAIN", () => {
  it("va de opus-5 a sonnet-5, como decide PLAN.md", () => {
    expect(DEFAULT_MODEL_CHAIN).toEqual(["claude-opus-5", "claude-sonnet-5"]);
  });
});
