import { EXAMPLE_SPRITE_SPEC } from "@asistente/shared";
import type { Express } from "express";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { ResponseCache } from "../cache/response-cache.js";
import { McpClientError } from "../mcp/client.js";
import { SqliteMetricsRepository } from "../telemetry/sqlite-repository.js";
import { fakePort, httpError, instantRetry, specResponse, TEST_CHAIN } from "../llm/test-support.js";
import type { AnthropicPort } from "../llm/anthropic-port.js";
import { LlmRefusalError } from "../llm/types.js";
import {
  eventTypes,
  fakeMcp,
  postGenerate,
  stageNames,
  type FakeMcp,
} from "./test-support.js";

/**
 * Integración del endpoint con LLM y MCP mockeados. Se ejercita el stream SSE real (supertest
 * habla HTTP de verdad), no una simulación del mismo.
 */

const disposables: Array<() => void> = [];

interface Harness {
  app: Express;
  metrics: SqliteMetricsRepository;
  mcp: FakeMcp;
  cache: ResponseCache;
}

function makeHarness(
  options: { port?: AnthropicPort; mcp?: FakeMcp; withCache?: boolean } = {},
): Harness {
  const metrics = new SqliteMetricsRepository();
  const cache = new ResponseCache();
  const mcp = options.mcp ?? fakeMcp();
  disposables.push(() => {
    metrics.close();
    cache.close();
  });

  const app = createApp({
    port: options.port ?? fakePort([specResponse()]),
    mcp,
    metrics,
    ...(options.withCache === false ? {} : { cache }),
    chain: TEST_CHAIN,
    onLog: () => {},
  });

  return { app, metrics, mcp, cache };
}

afterEach(() => {
  while (disposables.length > 0) disposables.pop()?.();
  vi.restoreAllMocks();
});

describe("POST /api/generate", () => {
  it("emite la secuencia esperada de eventos y termina en done", async () => {
    const { app } = makeHarness();

    const { events } = await postGenerate(app);

    const types = eventTypes(events);
    expect(types).toContain("stage");
    expect(types).toContain("spec_final");
    expect(types).toContain("render_progress");
    expect(types.at(-1)).toBe("done");

    // Etapas en orden, sin saltarse ninguna en el camino feliz.
    expect(stageNames(events)).toEqual(["cache", "llm", "validate", "render", "export"]);
  });

  it("el evento done trae rutas y métricas completas", async () => {
    const { app } = makeHarness();

    const { events } = await postGenerate(app);
    const done = events.find((event) => event.type === "done");

    expect(done?.data["filePath"]).toBe("/out/gem-icon.aseprite");
    expect(done?.data["spritesheetPath"]).toBe("/out/gem-icon.png");

    const metrics = done?.data["metrics"] as Record<string, unknown>;
    expect(metrics["model"]).toBe("claude-opus-5");
    expect(metrics["cache"]).toBe("miss");
    expect(metrics["costUsd"]).toBeGreaterThan(0);
    // Las latencias van desglosadas: sin esto no se sabe dónde se va el tiempo.
    expect(metrics).toHaveProperty("llmMs");
    expect(metrics).toHaveProperty("renderMs");
    expect(metrics).toHaveProperty("validateMs");
    expect(metrics).toHaveProperty("totalMs");
  });

  it("transmite el spec en streaming, no como un único JSON al final", async () => {
    const port = fakePort([
      (request) => {
        request.onTextDelta?.('{"schemaVersion":');
        request.onTextDelta?.('"1.0.0"}');
        return specResponse();
      },
    ]);
    const { app } = makeHarness({ port });

    const { events } = await postGenerate(app);
    const deltas = events.filter((event) => event.type === "spec_delta");

    expect(deltas).toHaveLength(2);
    expect(deltas[0]?.data["text"]).toBe('{"schemaVersion":');
    // Y llegan ANTES del spec_final.
    expect(eventTypes(events).indexOf("spec_delta")).toBeLessThan(
      eventTypes(events).indexOf("spec_final"),
    );
  });

  it("un cache hit se salta la etapa llm y registra coste 0", async () => {
    const { app, metrics } = makeHarness();

    const first = await postGenerate(app);
    expect(stageNames(first.events)).toContain("llm");

    const second = await postGenerate(app);

    expect(stageNames(second.events)).not.toContain("llm");
    expect(stageNames(second.events)).toEqual(["cache", "validate", "render", "export"]);

    const done = second.events.find((event) => event.type === "done");
    const doneMetrics = done?.data["metrics"] as Record<string, unknown>;
    expect(doneMetrics["cache"]).toBe("hit");
    expect(doneMetrics["costUsd"]).toBe(0);

    const recorded = metrics.recent(10);
    expect(recorded[0]?.cache).toBe("hit");
    expect(recorded[0]?.costUsd).toBe(0);
  });

  it("un fallo del MCP produce un evento error y CIERRA el stream", async () => {
    const mcp = fakeMcp(() => {
      throw new McpClientError("tool_error", "Aseprite rechazó el script: [mcp]:12: boom");
    });
    const { app } = makeHarness({ mcp });

    // Si el stream no cerrara, supertest nunca resolvería y esto haría timeout.
    const { events } = await postGenerate(app);

    const error = events.find((event) => event.type === "error");
    expect(error?.data["code"]).toBe("mcp_tool_error");
    expect(error?.data["message"]).toContain("[mcp]:12: boom");
    expect(eventTypes(events)).not.toContain("done");
  });

  it("un refusal del modelo llega como error tipado y no retryable", async () => {
    const port = fakePort([new LlmRefusalError("claude-opus-5", "cyber", "declinado")]);
    const { app } = makeHarness({ port });

    const { events } = await postGenerate(app);
    const error = events.find((event) => event.type === "error");

    expect(error?.data["code"]).toBe("refusal");
    expect(error?.data["retryable"]).toBe(false);
  });

  it("registra también las peticiones fallidas, con su código de error", async () => {
    const mcp = fakeMcp(() => {
      throw new McpClientError("tool_error", "boom");
    });
    const { app, metrics } = makeHarness({ mcp });

    await postGenerate(app);

    const [recorded] = metrics.recent(1);
    expect(recorded?.status).toBe("error");
    expect(recorded?.errorCode).toBe("mcp_tool_error");
  });

  it("no llama al MCP si el modelo falla antes", async () => {
    const port = fakePort([httpError(400, "petición inválida")]);
    const mcp = fakeMcp();
    const { app } = makeHarness({ port, mcp });

    await postGenerate(app);

    expect(mcp.calls).toHaveLength(0);
  });

  it("rechaza un prompt vacío con 400 y sin abrir stream", async () => {
    const { app } = makeHarness();

    const response = await postGenerate(app, "   ");

    expect(response.status).toBe(400);
    expect(response.events).toHaveLength(0);
  });

  it("render_progress reporta el total de frames real", async () => {
    const { app } = makeHarness();

    const { events } = await postGenerate(app);
    const progress = events.filter((event) => event.type === "render_progress");

    expect(progress).toHaveLength(2);
    expect(progress[0]?.data).toEqual({ frame: 0, total: EXAMPLE_SPRITE_SPEC.frames.length });
    expect(progress[1]?.data).toEqual({
      frame: EXAMPLE_SPRITE_SPEC.frames.length,
      total: EXAMPLE_SPRITE_SPEC.frames.length,
    });
  });

  it("propaga los warnings del MCP en el done", async () => {
    const mcp = fakeMcp(() => ({
      filePath: "/out/a.aseprite",
      spritesheetPath: "/out/a.png",
      jsonPath: "/out/a.json",
      frameCount: 1,
      warnings: ["Todos los frames duran lo mismo"],
      asepriteStatus: "OK",
    }));
    const { app } = makeHarness({ mcp });

    const { events } = await postGenerate(app);
    const done = events.find((event) => event.type === "done");

    expect(done?.data["warnings"]).toEqual(["Todos los frames duran lo mismo"]);
  });

  it("registra el fallback de modelo en la telemetría", async () => {
    const port = fakePort([
      httpError(529),
      httpError(529),
      httpError(529),
      specResponse(undefined, { servedByModel: "claude-sonnet-5" }),
    ]);
    const { app, metrics } = makeHarness({ port });

    await postGenerate(app);

    const [recorded] = metrics.recent(1);
    expect(recorded?.model).toBe("claude-sonnet-5");
    expect(recorded?.fellBack).toBe(true);
    expect(recorded?.attempts).toBe(4);
  });

  it("no guarda el prompt en claro, sólo su hash y un preview", async () => {
    const { app, metrics } = makeHarness();
    const prompt = "un icono de gema secreta 8x8";

    await postGenerate(app, prompt);

    const [recorded] = metrics.recent(1);
    expect(recorded?.promptHash).toMatch(/^[0-9a-f]{64}$/u);
    expect(recorded?.promptHash).not.toContain(prompt);
  });
});

// `instantRetry` se usa a través de los defaults del router; se referencia aquí para que quede
// explícito que ningún test de este fichero espera de verdad a un backoff.
void instantRetry;
