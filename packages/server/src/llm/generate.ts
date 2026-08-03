import {
  SPRITE_SPEC_SCHEMA_VERSION,
  SpriteSpecSchema,
  spriteSpecJsonSchema,
  type ModelId,
} from "@asistente/shared";
import { ResponseCache, type CacheKeyParts } from "../cache/response-cache.js";
import type { AnthropicPort, EffortLevel } from "./anthropic-port.js";
import {
  DEFAULT_MODEL_CHAIN,
  runWithModelFallback,
  type RunWithFallbackOptions,
} from "./fallback.js";
import { SPRITE_SPEC_SYSTEM_PROMPT } from "./prompts/sprite-spec-system.js";
import {
  EMPTY_USAGE,
  LlmError,
  SpecValidationError,
  type GenerateSpriteSpecResult,
  type LlmUsage,
} from "./types.js";

/**
 * El pixel-map hace que el spec sea largo: con 32x32 y 8 frames son miles de caracteres.
 * Por debajo de esto la respuesta se trunca a media generación.
 */
export const DEFAULT_MAX_TOKENS = 32_000;
export const DEFAULT_EFFORT: EffortLevel = "high";

export interface GenerateSpriteSpecOptions {
  prompt: string;
  port: AnthropicPort;
  cache?: ResponseCache;
  chain?: readonly ModelId[];
  maxTokens?: number;
  effort?: EffortLevel;
  systemPrompt?: string;
  serverSideFallback?: boolean;
  signal?: AbortSignal;
  onTextDelta?: (delta: string) => void;
  onThinkingStart?: () => void;
  onUsage?: (usage: LlmUsage) => void;
  retry?: RunWithFallbackOptions;
  now?: () => number;
}

/**
 * `z.toJSONSchema` emite `$schema` en la raíz. La API no lo espera dentro de
 * `output_config.format.schema`, así que lo quitamos justo en la frontera con el SDK.
 */
function stripSchemaDialect(schema: Record<string, unknown>): Record<string, unknown> {
  const { $schema: _dialect, ...rest } = schema;
  return rest;
}

/** Extrae el primer objeto JSON del texto, tolerando que el modelo lo envuelva en ```json. */
function parseSpecJson(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/u.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch (error) {
    throw new SpecValidationError([
      `la respuesta del modelo no es JSON válido: ${(error as Error).message}`,
    ]);
  }
}

/**
 * Genera un `SpriteSpec` validado a partir de un prompt en lenguaje natural.
 *
 * Orden de operaciones: caché → modelo (streaming, con reintentos y fallback) → validación Zod →
 * persistencia en caché. Un `hit` de caché devuelve sin tocar el SDK: coste 0, cero llamadas.
 *
 * La API garantiza la *forma* del JSON vía structured outputs; Zod garantiza los *invariantes
 * cruzados* de la fase 01 (rangos de tags, índices de paleta, filas del pixel-map). Ambas cosas
 * son necesarias: structured outputs no puede expresar "el índice existe en la paleta".
 */
export async function generateSpriteSpec(
  options: GenerateSpriteSpecOptions,
): Promise<GenerateSpriteSpecResult> {
  const now = options.now ?? Date.now;
  const startedAt = now();
  const systemPrompt = options.systemPrompt ?? SPRITE_SPEC_SYSTEM_PROMPT;
  const chain = options.chain ?? DEFAULT_MODEL_CHAIN;
  const primaryModel = chain[0];
  if (primaryModel === undefined) {
    throw new LlmError("retries_exhausted", "La cadena de modelos está vacía.");
  }

  const keyParts: CacheKeyParts = {
    prompt: options.prompt,
    schemaVersion: SPRITE_SPEC_SCHEMA_VERSION,
    model: primaryModel,
    systemPrompt,
  };

  const cached = options.cache?.lookup(keyParts);
  if (cached?.hit === true) {
    return {
      spec: cached.spec,
      model: cached.metadata.model,
      usage: { ...EMPTY_USAGE },
      latencyMs: now() - startedAt,
      attempts: 0,
      cache: "hit",
      fellBack: false,
    };
  }

  const { response, model, attempts, fellBack } = await runWithModelFallback(
    options.port,
    {
      systemPrompt,
      userPrompt: options.prompt,
      jsonSchema: stripSchemaDialect(spriteSpecJsonSchema()),
      maxTokens: options.maxTokens ?? DEFAULT_MAX_TOKENS,
      effort: options.effort ?? DEFAULT_EFFORT,
      ...(options.serverSideFallback === undefined
        ? {}
        : { serverSideFallback: options.serverSideFallback }),
      ...(options.onTextDelta ? { onTextDelta: options.onTextDelta } : {}),
      ...(options.onThinkingStart ? { onThinkingStart: options.onThinkingStart } : {}),
      ...(options.onUsage ? { onUsage: options.onUsage } : {}),
      ...(options.signal ? { signal: options.signal } : {}),
    },
    { ...options.retry, chain },
  );

  const parsed = SpriteSpecSchema.safeParse(parseSpecJson(response.text));
  if (!parsed.success) {
    throw new SpecValidationError(
      parsed.error.issues.map((issue) => `${issue.path.join(".") || "<raíz>"}: ${issue.message}`),
    );
  }

  options.cache?.store({
    ...keyParts,
    spec: parsed.data,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
  });

  return {
    spec: parsed.data,
    model,
    usage: response.usage,
    latencyMs: now() - startedAt,
    attempts,
    cache: "miss",
    fellBack,
  };
}
