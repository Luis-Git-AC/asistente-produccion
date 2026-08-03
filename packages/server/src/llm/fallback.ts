import type { ModelId } from "@asistente/shared";
import type { AnthropicPort, SpecMessageRequest, SpecMessageResponse } from "./anthropic-port.js";
import { isRetryableError, withRetry, type WithRetryOptions } from "./retry.js";
import { LlmError, RetriesExhaustedError } from "./types.js";

/**
 * Cadena de modelos. El fallback propio cubre el caso "el primario está caído o rate-limited";
 * es complementario al fallback server-side por refusal (`fallbacks: "default"`), que cubre
 * "el primario declinó la petición" y se resuelve dentro de una sola llamada.
 */
export const DEFAULT_MODEL_CHAIN: readonly ModelId[] = ["claude-opus-5", "claude-sonnet-5"];

/**
 * Construye la cadena poniendo `primary` al frente y conservando el resto como fallback.
 *
 * Elegir modelo NO desactiva el fallback: sigue siendo un mecanismo de fiabilidad, no una
 * preferencia del usuario. Si eliges `sonnet-5` y se cae, la petición se sirve con `opus-5`
 * antes que fallar — y la telemetría lo registra con `fellBack: true`.
 */
export function buildModelChain(
  primary: ModelId,
  available: readonly ModelId[] = DEFAULT_MODEL_CHAIN,
): readonly ModelId[] {
  return [primary, ...available.filter((model) => model !== primary)];
}

export interface RunWithFallbackOptions extends WithRetryOptions {
  chain?: readonly ModelId[];
  onModelFallback?: (info: { from: ModelId; to: ModelId; error: unknown }) => void;
}

export interface RunWithFallbackResult {
  response: SpecMessageResponse;
  /** Modelo de la cadena que atendió la petición. */
  model: ModelId;
  /** Intentos totales sumando todos los modelos de la cadena. */
  attempts: number;
  fellBack: boolean;
}

/**
 * Recorre la cadena de modelos. Por cada modelo aplica la política de reintentos completa; sólo
 * cuando ese modelo agota sus intentos con un error reintentable se salta al siguiente. Un error
 * no reintentable (400, refusal, spec inválido) aborta la cadena entera de inmediato: reintentar
 * en otro modelo no arreglaría una petición mal formada.
 */
export async function runWithModelFallback(
  port: AnthropicPort,
  request: Omit<SpecMessageRequest, "model">,
  options: RunWithFallbackOptions = {},
): Promise<RunWithFallbackResult> {
  const chain = options.chain ?? DEFAULT_MODEL_CHAIN;
  if (chain.length === 0) {
    throw new LlmError("retries_exhausted", "La cadena de modelos está vacía.");
  }

  let totalAttempts = 0;
  let lastError: unknown;

  for (let i = 0; i < chain.length; i += 1) {
    const model = chain[i]!;
    // Contamos sobre las invocaciones reales en vez de asumir `policy.maxAttempts`: si el modelo
    // falla con un error no reintentable al primer intento, `attempts` debe reflejar 1, no 3.
    let modelAttempts = 0;
    try {
      const { value } = await withRetry(() => {
        modelAttempts += 1;
        return port.createSpecMessage({ ...request, model });
      }, options);
      totalAttempts += modelAttempts;
      return { response: value, model, attempts: totalAttempts, fellBack: i > 0 };
    } catch (error) {
      totalAttempts += modelAttempts;
      lastError = error;

      // Sólo saltamos de modelo si el fallo era transitorio. Un 400 o un refusal se propagan.
      if (!isRetryableError(error)) throw error;

      const next = chain[i + 1];
      if (next === undefined) break;
      options.onModelFallback?.({ from: model, to: next, error });
    }
  }

  throw new RetriesExhaustedError(totalAttempts, lastError);
}

/**
 * Decorador que fuerza el fallo del modelo primario, para demostrar el fallback sin esperar a un
 * incidente real. Se activa con `SIMULATE_5XX=1`.
 */
export function withSimulatedPrimaryFailure(
  port: AnthropicPort,
  options: { enabled: boolean; primaryModel?: ModelId },
): AnthropicPort {
  if (!options.enabled) return port;
  const primary = options.primaryModel ?? DEFAULT_MODEL_CHAIN[0]!;

  return {
    async createSpecMessage(request: SpecMessageRequest): Promise<SpecMessageResponse> {
      if (request.model === primary) {
        const error = new LlmError(
          "simulated_failure",
          `SIMULATE_5XX activo: se fuerza un 529 en ${primary}.`,
          { retryable: true },
        );
        // `status` es lo que lee `isRetryableError`, así que el fallo simulado recorre exactamente
        // el mismo camino que un 529 real.
        Object.defineProperty(error, "status", { value: 529, enumerable: true });
        throw error;
      }
      return port.createSpecMessage(request);
    },
  };
}

/** Lee el flag `SIMULATE_5XX` del entorno. Cualquier valor distinto de "1"/"true" lo desactiva. */
export function simulate5xxEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  const raw = env["SIMULATE_5XX"]?.trim().toLowerCase();
  return raw === "1" || raw === "true";
}
