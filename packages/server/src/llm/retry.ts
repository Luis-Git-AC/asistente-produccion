/**
 * Política de reintentos propia.
 *
 * El SDK de Anthropic ya reintenta 408/409/429/5xx por su cuenta (`maxRetries`, por defecto 2).
 * Aquí lo desactivamos (`maxRetries: 0` en el cliente) y reimplementamos la política por dos
 * razones concretas, no por gusto:
 *
 *  1. **Control del fallback de modelo.** El SDK reintenta siempre contra el mismo modelo. Nosotros
 *     necesitamos agotar los reintentos del primario y sólo entonces saltar a `claude-sonnet-5`.
 *  2. **Telemetría por intento.** La fase 06 reporta `attempts` y latencia por intento. Con los
 *     reintentos internos del SDK esa información no sale de la librería.
 */

/** Códigos HTTP que merecen reintento: sobrecarga, rate limit y errores transitorios de servidor. */
const RETRYABLE_STATUS = new Set([408, 409, 429, 500, 502, 503, 504, 529]);

/** Códigos que nunca se reintentan: el problema es la petición, no el servidor. */
const NON_RETRYABLE_STATUS = new Set([400, 401, 403, 404, 413, 422]);

export interface RetryPolicy {
  /** Intentos totales por modelo, incluyendo el primero. */
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
}

export const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 500,
  maxDelayMs: 8_000,
};

function readStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" ? status : undefined;
}

/**
 * Un error es reintentable si es un 429/5xx conocido, o si es un fallo de red/timeout
 * (sin `status`, con nombre o marca de conexión). Un 400 nunca se reintenta.
 */
export function isRetryableError(error: unknown): boolean {
  const status = readStatus(error);
  if (status !== undefined) {
    if (NON_RETRYABLE_STATUS.has(status)) return false;
    if (RETRYABLE_STATUS.has(status)) return true;
    return status >= 500;
  }

  if (typeof error === "object" && error !== null) {
    const name = (error as { name?: unknown }).name;
    if (typeof name === "string" && /connection|timeout|abort/i.test(name)) return true;
    const code = (error as { code?: unknown }).code;
    if (typeof code === "string" && /ETIMEDOUT|ECONNRESET|ECONNREFUSED|EPIPE/i.test(code)) {
      return true;
    }
  }
  return false;
}

/** Lee la cabecera `retry-after` (segundos o fecha HTTP) del error del SDK, si viene. */
export function retryAfterMs(error: unknown, now: number = Date.now()): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const headers = (error as { headers?: unknown }).headers;
  if (headers === undefined || headers === null) return undefined;

  let raw: string | null | undefined;
  if (typeof (headers as Headers).get === "function") {
    raw = (headers as Headers).get("retry-after");
  } else if (typeof headers === "object") {
    const value = (headers as Record<string, unknown>)["retry-after"];
    raw = typeof value === "string" ? value : undefined;
  }
  if (raw === undefined || raw === null || raw.trim() === "") return undefined;

  const seconds = Number(raw);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);

  const date = Date.parse(raw);
  if (Number.isFinite(date)) return Math.max(0, date - now);
  return undefined;
}

/** Backoff exponencial con jitter completo, acotado por `maxDelayMs`. */
export function backoffDelayMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number = Math.random,
): number {
  const exponential = Math.min(policy.maxDelayMs, policy.baseDelayMs * 2 ** (attempt - 1));
  return Math.round(exponential * random());
}

export interface WithRetryOptions {
  policy?: RetryPolicy;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  /** Se invoca antes de cada reintento; útil para logging y telemetría por intento. */
  onRetry?: (info: { attempt: number; delayMs: number; error: unknown }) => void;
}

export interface WithRetryResult<T> {
  value: T;
  /** Intentos consumidos hasta el éxito (1 = acertó a la primera). */
  attempts: number;
}

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    setTimeout(resolve, ms);
  });

/**
 * Ejecuta `fn` aplicando la política de reintentos. Devuelve el valor y cuántos intentos costó.
 * Si se agotan los intentos (o el error no es reintentable) relanza el último error.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: WithRetryOptions = {},
): Promise<WithRetryResult<T>> {
  const policy = options.policy ?? DEFAULT_RETRY_POLICY;
  const sleep = options.sleep ?? defaultSleep;
  const random = options.random ?? Math.random;

  let lastError: unknown;
  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    try {
      const value = await fn(attempt);
      return { value, attempts: attempt };
    } catch (error) {
      lastError = error;
      const isLastAttempt = attempt === policy.maxAttempts;
      if (isLastAttempt || !isRetryableError(error)) throw error;

      const delayMs = retryAfterMs(error) ?? backoffDelayMs(attempt, policy, random);
      options.onRetry?.({ attempt, delayMs, error });
      await sleep(delayMs);
    }
  }
  throw lastError;
}
