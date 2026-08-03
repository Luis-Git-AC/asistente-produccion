import type Anthropic from "@anthropic-ai/sdk";
import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import type { ModelId } from "@asistente/shared";
import { EMPTY_USAGE, LlmError, LlmRefusalError, type LlmUsage } from "./types.js";

/**
 * Beta del fallback server-side por refusal en su forma escalar (`fallbacks: "default"`).
 * Ojo: la forma en array usa la beta `-2026-06-01`; cruzar cabecera y forma devuelve 400.
 */
export const SERVER_SIDE_FALLBACK_BETA = "server-side-fallback-2026-07-01";

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface SpecMessageRequest {
  model: ModelId;
  systemPrompt: string;
  userPrompt: string;
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  effort: EffortLevel;
  /** Fallback server-side por refusal. Se desactiva en tests para aislar el fallback propio. */
  serverSideFallback?: boolean;
  onTextDelta?: (delta: string) => void;
  onThinkingStart?: () => void;
  onUsage?: (usage: LlmUsage) => void;
  signal?: AbortSignal;
}

export interface SpecMessageResponse {
  /** Texto concatenado de los bloques `text`: el JSON del `SpriteSpec`. */
  text: string;
  usage: LlmUsage;
  /** Modelo que sirvió realmente la respuesta (puede diferir por fallback server-side). */
  servedByModel: string;
}

/**
 * Puerto estrecho sobre el SDK. Todo lo que la capa de orquestación necesita de Anthropic pasa
 * por aquí, así que los tests inyectan un doble y no se hace red en ningún test unitario.
 */
export interface AnthropicPort {
  createSpecMessage(request: SpecMessageRequest): Promise<SpecMessageResponse>;
}

function normalizeUsage(usage: BetaMessage["usage"] | undefined): LlmUsage {
  if (!usage) return { ...EMPTY_USAGE };
  return {
    input_tokens: usage.input_tokens ?? 0,
    output_tokens: usage.output_tokens ?? 0,
    cache_read_input_tokens: usage.cache_read_input_tokens ?? 0,
    cache_creation_input_tokens: usage.cache_creation_input_tokens ?? 0,
  };
}

/**
 * Extrae el texto de un `BetaMessage`. **Sólo debe llamarse tras comprobar `stop_reason`**:
 * en un refusal `content` puede venir vacío o parcial.
 */
export function extractText(message: BetaMessage): string {
  return message.content
    .filter((block): block is Extract<BetaMessage["content"][number], { type: "text" }> =>
      block.type === "text",
    )
    .map((block) => block.text)
    .join("");
}

/**
 * Convierte un `BetaMessage` en la respuesta normalizada del puerto, comprobando el refusal
 * ANTES de tocar `content`. `stop_details` es informativo y puede ser `null` incluso en un
 * refusal, así que la rama se decide por `stop_reason`, nunca por `stop_details`.
 */
export function toSpecMessageResponse(message: BetaMessage, requestedModel: ModelId): SpecMessageResponse {
  if (message.stop_reason === "refusal") {
    const details = message.stop_details;
    const category = details !== null && details !== undefined && "category" in details
      ? (details.category ?? null)
      : null;
    const explanation = details !== null && details !== undefined && "explanation" in details
      ? (details.explanation ?? null)
      : null;
    throw new LlmRefusalError(requestedModel, category, explanation);
  }

  const text = extractText(message);
  if (text.trim() === "") {
    throw new LlmError(
      "empty_response",
      `El modelo ${requestedModel} devolvió una respuesta sin contenido de texto (stop_reason: ${String(message.stop_reason)}).`,
    );
  }

  return {
    text,
    usage: normalizeUsage(message.usage),
    servedByModel: message.model,
  };
}

/** Implementación real del puerto: streaming + structured output + prompt caching. */
export function createSdkAnthropicPort(client: Anthropic): AnthropicPort {
  return {
    async createSpecMessage(request: SpecMessageRequest): Promise<SpecMessageResponse> {
      const stream = client.beta.messages.stream(
        {
          model: request.model,
          max_tokens: request.maxTokens,
          // `thinking` adaptativo + `effort`. NUNCA enviar temperature/top_p/top_k/budget_tokens:
          // devuelven 400 en Opus 5.
          thinking: { type: "adaptive" },
          output_config: {
            effort: request.effort,
            format: { type: "json_schema", schema: request.jsonSchema },
          },
          ...(request.serverSideFallback === false
            ? {}
            : { betas: [SERVER_SIDE_FALLBACK_BETA], fallbacks: "default" as const }),
          // El breakpoint de caché va al final del bloque estable. El prompt del usuario viaja
          // después, en `messages`, para no invalidar el prefijo cacheado.
          system: [
            {
              type: "text",
              text: request.systemPrompt,
              cache_control: { type: "ephemeral" },
            },
          ],
          messages: [{ role: "user", content: request.userPrompt }],
        },
        request.signal ? { signal: request.signal } : {},
      );

      let thinkingAnnounced = false;
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "thinking") {
          if (!thinkingAnnounced) {
            thinkingAnnounced = true;
            request.onThinkingStart?.();
          }
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
          request.onTextDelta?.(event.delta.text);
        }
      }

      const message = await stream.finalMessage();
      const response = toSpecMessageResponse(message, request.model);
      request.onUsage?.(response.usage);
      return response;
    },
  };
}
