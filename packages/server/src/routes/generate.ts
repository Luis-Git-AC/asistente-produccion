import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { estimateCostUsd, type ModelId } from "@asistente/shared";
import type { ResponseCache } from "../cache/response-cache.js";
import { generateSpriteSpec } from "../llm/generate.js";
import type { AnthropicPort, EffortLevel } from "../llm/anthropic-port.js";
import { LlmError } from "../llm/types.js";
import { McpClientError, type AsepriteMcpPort } from "../mcp/client.js";
import { sha256 } from "../cache/response-cache.js";
import type { MetricsRepository, RequestMetrics } from "../telemetry/types.js";
import type { GenerationStage } from "@asistente/shared";
import { toAssetUrl } from "./assets.js";
import { SseWriter } from "./sse.js";

/**
 * Orquestador. Une las piezas: caché → modelo → validación → MCP → telemetría, transmitiendo
 * el progreso por SSE.
 *
 * Aquí NO vive lógica de prompts ni de reintentos: eso es la fase 02. Este módulo coordina.
 */

export interface GenerateRouteDeps {
  port: AnthropicPort;
  mcp: AsepriteMcpPort;
  metrics: MetricsRepository;
  cache?: ResponseCache;
  effort?: EffortLevel;
  chain?: readonly ModelId[];
  now?: () => number;
  onLog?: (message: string, context: Record<string, unknown>) => void;
}

const MAX_PROMPT_LENGTH = 4000;

interface ErrorShape {
  code: string;
  message: string;
  retryable: boolean;
}

/** Traduce cualquier fallo a la forma del evento `error`, sin filtrar internos al cliente. */
export function toErrorShape(error: unknown): ErrorShape {
  if (error instanceof LlmError) {
    return { code: error.code, message: error.message, retryable: error.retryable };
  }
  if (error instanceof McpClientError) {
    return {
      code: `mcp_${error.code}`,
      message: error.message,
      // Un fallo de arranque o de conexión puede resolverse abriendo Aseprite y reintentando.
      retryable: error.code === "spawn_failed" || error.code === "tool_error",
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return { code: "aborted", message: "La petición se canceló.", retryable: false };
  }
  return { code: "internal_error", message: "Error interno del servidor.", retryable: false };
}

export function createGenerateRouter(deps: GenerateRouteDeps): Router {
  const router = Router();
  const now = deps.now ?? Date.now;
  const log = deps.onLog ?? ((): void => {});

  router.post("/generate", async (req: Request, res: Response) => {
    const requestId = randomUUID();
    const startedAt = now();

    const prompt = typeof req.body?.prompt === "string" ? req.body.prompt.trim() : "";
    if (prompt === "" || prompt.length > MAX_PROMPT_LENGTH) {
      res.status(400).json({
        code: "invalid_prompt",
        message: `El campo 'prompt' es obligatorio y debe medir entre 1 y ${String(MAX_PROMPT_LENGTH)} caracteres.`,
      });
      return;
    }

    const sse = new SseWriter(res);
    const abort = new AbortController();

    // El cliente colgó: cancelamos el trabajo en curso en vez de seguir gastando tokens.
    //
    // Se escucha en `res`, no en `req`: el evento `close` de `req` salta en cuanto se termina de
    // leer el cuerpo, que en un POST ocurre inmediatamente, así que ahí abortaría siempre. En
    // `res`, un `close` con `writableEnded === false` sí significa que el cliente se fue.
    res.on("close", () => {
      if (!res.writableEnded) {
        sse.markClientGone();
        abort.abort();
        log("cliente desconectado, trabajo cancelado", { requestId });
      }
    });

    const stage = (name: GenerationStage): void => {
      sse.send({ type: "stage", data: { stage: name, elapsedMs: now() - startedAt } });
    };

    let model: ModelId = deps.chain?.[0] ?? "claude-opus-5";
    let cache: "hit" | "miss" = "miss";
    let attempts = 0;
    let fellBack = false;
    let llmMs = 0;
    let validateMs = 0;
    let renderMs = 0;
    let costUsd = 0;
    let usage = {
      input_tokens: 0,
      output_tokens: 0,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    };
    let filePath: string | null = null;
    let spritesheetPath: string | null = null;
    let status: RequestMetrics["status"] = "ok";
    let errorCode: string | null = null;

    try {
      stage("cache");

      const llmStartedAt = now();
      const result = await generateSpriteSpec({
        prompt,
        port: deps.port,
        ...(deps.cache ? { cache: deps.cache } : {}),
        ...(deps.chain ? { chain: deps.chain } : {}),
        ...(deps.effort ? { effort: deps.effort } : {}),
        signal: abort.signal,
        onCacheResult: (outcome) => {
          cache = outcome;
          // En un hit no hay etapa `llm`: anunciarla sería mentirle a la UI.
          if (outcome === "miss") stage("llm");
        },
        onTextDelta: (text) => {
          sse.send({ type: "spec_delta", data: { text } });
        },
      });
      llmMs = now() - llmStartedAt;

      model = result.model;
      attempts = result.attempts;
      fellBack = result.fellBack;
      usage = result.usage;
      cache = result.cache;
      costUsd =
        result.cache === "hit"
          ? 0
          : estimateCostUsd({
              model: result.model,
              inputTokens: usage.input_tokens,
              outputTokens: usage.output_tokens,
              cacheReadTokens: usage.cache_read_input_tokens,
              cacheCreationTokens: usage.cache_creation_input_tokens,
            });

      // El spec ya viene validado por Zod desde la fase 02; la etapa `validate` existe para que
      // la UI pueda mostrarla y para medir su coste por separado.
      const validateStartedAt = now();
      stage("validate");
      sse.send({ type: "spec_final", data: { spec: result.spec } });
      validateMs = now() - validateStartedAt;

      if (abort.signal.aborted) throw new Error("aborted");

      stage("render");
      const totalFrames = result.spec.frames.length;
      // El MCP renderiza en UN solo round-trip (esa es la regla del protocolo batched), así que
      // no hay progreso real por frame que reportar. Se emiten los extremos y nada inventado.
      sse.send({ type: "render_progress", data: { frame: 0, total: totalFrames } });

      const renderStartedAt = now();
      const render = await deps.mcp.generateSprite(result.spec);
      renderMs = now() - renderStartedAt;

      sse.send({ type: "render_progress", data: { frame: totalFrames, total: totalFrames } });
      stage("export");

      filePath = render.filePath;
      spritesheetPath = render.spritesheetPath;

      sse.send({
        type: "done",
        data: {
          requestId,
          filePath,
          spritesheetPath,
          // La web no puede abrir una ruta de disco: se le da la URL servible ya montada.
          spritesheetUrl: toAssetUrl(spritesheetPath),
          warnings: render.warnings,
          metrics: {
            model,
            cache,
            attempts,
            fellBack,
            inputTokens: usage.input_tokens,
            outputTokens: usage.output_tokens,
            cacheReadTokens: usage.cache_read_input_tokens,
            cacheCreationTokens: usage.cache_creation_input_tokens,
            costUsd,
            llmMs,
            validateMs,
            renderMs,
            totalMs: now() - startedAt,
          },
        },
      });
    } catch (error) {
      status = "error";
      const shape = toErrorShape(error);
      errorCode = shape.code;
      log("petición fallida", { requestId, code: shape.code });
      sse.send({ type: "error", data: shape });
    } finally {
      // Pase lo que pase: se registra la telemetría y se cierra el stream. Un stream que no
      // cierra deja al cliente colgado indefinidamente.
      try {
        deps.metrics.record({
          requestId,
          promptHash: sha256(prompt),
          promptPreview: prompt.slice(0, 200),
          model,
          attempts,
          fellBack,
          cache,
          inputTokens: usage.input_tokens,
          outputTokens: usage.output_tokens,
          cacheReadTokens: usage.cache_read_input_tokens,
          cacheCreationTokens: usage.cache_creation_input_tokens,
          costUsd,
          llmMs,
          validateMs,
          renderMs,
          totalMs: now() - startedAt,
          status,
          errorCode,
          filePath,
          spritesheetPath,
          createdAt: startedAt,
        });
      } catch (metricsError) {
        log("no se pudo registrar la telemetría", {
          requestId,
          error: metricsError instanceof Error ? metricsError.message : String(metricsError),
        });
      }
      sse.close();
    }
  });

  return router;
}
