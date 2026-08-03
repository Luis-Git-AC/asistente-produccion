import type { ModelId, SpriteSpec } from "@asistente/shared";

/** Tokens de uso de una petición, con los campos de caché que alimentan la telemetría. */
export interface LlmUsage {
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cache_creation_input_tokens: number;
}

export const EMPTY_USAGE: LlmUsage = {
  input_tokens: 0,
  output_tokens: 0,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
};

/** Resultado unificado de `generateSpriteSpec`. */
export interface GenerateSpriteSpecResult {
  spec: SpriteSpec;
  model: ModelId;
  usage: LlmUsage;
  latencyMs: number;
  /** Número total de intentos contra la API, sumando todos los modelos de la cadena. */
  attempts: number;
  cache: "hit" | "miss";
  /** `true` si el modelo primario se agotó y respondió un modelo de la cadena de fallback. */
  fellBack: boolean;
}

export type LlmErrorCode =
  | "refusal"
  | "invalid_spec"
  | "empty_response"
  | "retries_exhausted"
  | "simulated_failure";

/** Error base tipado de la capa LLM. Nunca expone la API key ni el cuerpo crudo de la petición. */
export class LlmError extends Error {
  readonly code: LlmErrorCode;
  readonly retryable: boolean;

  constructor(code: LlmErrorCode, message: string, options?: { retryable?: boolean }) {
    super(message);
    this.name = new.target.name;
    this.code = code;
    this.retryable = options?.retryable ?? false;
  }
}

/**
 * El modelo declinó la petición (`stop_reason === "refusal"`). Se detecta ANTES de leer
 * `content`, que en un refusal puede venir vacío o parcial.
 */
export class LlmRefusalError extends LlmError {
  readonly category: string | null;
  readonly modelId: ModelId;

  constructor(modelId: ModelId, category: string | null, explanation: string | null) {
    super("refusal", explanation ?? `El modelo ${modelId} declinó la petición.`);
    this.category = category;
    this.modelId = modelId;
  }
}

/** El modelo devolvió algo que no cumple los invariantes cruzados de `SpriteSpec`. */
export class SpecValidationError extends LlmError {
  readonly issues: readonly string[];

  constructor(issues: readonly string[]) {
    super("invalid_spec", `El spec devuelto no valida contra SpriteSpec: ${issues.join("; ")}`);
    this.issues = issues;
  }
}

/** Se agotaron los reintentos en todos los modelos de la cadena. */
export class RetriesExhaustedError extends LlmError {
  readonly attempts: number;

  constructor(attempts: number, cause: unknown) {
    super("retries_exhausted", `Reintentos agotados tras ${attempts} intento(s).`, {
      retryable: false,
    });
    this.attempts = attempts;
    this.cause = cause;
  }
}
