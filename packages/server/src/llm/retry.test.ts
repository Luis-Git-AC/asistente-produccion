import { describe, expect, it, vi } from "vitest";
import {
  backoffDelayMs,
  DEFAULT_RETRY_POLICY,
  isRetryableError,
  retryAfterMs,
  withRetry,
} from "./retry.js";
import { httpError, instantRetry } from "./test-support.js";

describe("isRetryableError", () => {
  it.each([408, 409, 429, 500, 502, 503, 504, 529])("reintenta el %i", (status) => {
    expect(isRetryableError(httpError(status))).toBe(true);
  });

  it.each([400, 401, 403, 404, 413, 422])("no reintenta el %i", (status) => {
    expect(isRetryableError(httpError(status))).toBe(false);
  });

  it("reintenta errores de conexión sin status", () => {
    const error = new Error("socket hang up");
    error.name = "APIConnectionError";
    expect(isRetryableError(error)).toBe(true);
  });

  it("reintenta timeouts por código de sistema", () => {
    const error = Object.assign(new Error("timed out"), { code: "ETIMEDOUT" });
    expect(isRetryableError(error)).toBe(true);
  });

  it("no reintenta un error corriente sin status ni código", () => {
    expect(isRetryableError(new Error("algo raro"))).toBe(false);
  });
});

describe("retryAfterMs", () => {
  it("lee retry-after en segundos desde unas Headers", () => {
    const error = Object.assign(httpError(429), { headers: new Headers({ "retry-after": "3" }) });
    expect(retryAfterMs(error)).toBe(3000);
  });

  it("lee retry-after desde un objeto plano de cabeceras", () => {
    const error = Object.assign(httpError(429), { headers: { "retry-after": "1.5" } });
    expect(retryAfterMs(error)).toBe(1500);
  });

  it("acepta retry-after como fecha HTTP", () => {
    const now = Date.parse("2026-01-01T00:00:00Z");
    const error = Object.assign(httpError(429), {
      headers: new Headers({ "retry-after": "Thu, 01 Jan 2026 00:00:10 GMT" }),
    });
    expect(retryAfterMs(error, now)).toBe(10_000);
  });

  it("devuelve undefined si no hay cabecera", () => {
    expect(retryAfterMs(httpError(429))).toBeUndefined();
  });
});

describe("backoffDelayMs", () => {
  it("crece exponencialmente y respeta el techo", () => {
    const policy = { maxAttempts: 6, baseDelayMs: 100, maxDelayMs: 500 };
    const full = (): number => 1;
    expect(backoffDelayMs(1, policy, full)).toBe(100);
    expect(backoffDelayMs(2, policy, full)).toBe(200);
    expect(backoffDelayMs(3, policy, full)).toBe(400);
    expect(backoffDelayMs(4, policy, full)).toBe(500);
  });

  it("aplica jitter: con random()=0 el delay es 0", () => {
    expect(backoffDelayMs(3, DEFAULT_RETRY_POLICY, () => 0)).toBe(0);
  });
});

describe("withRetry", () => {
  it("429 -> 429 -> 200 termina en éxito con attempts === 3", async () => {
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(httpError(429))
      .mockRejectedValueOnce(httpError(429))
      .mockResolvedValueOnce("ok");

    const result = await withRetry(fn, instantRetry);

    expect(result.value).toBe("ok");
    expect(result.attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it("acierta a la primera con attempts === 1", async () => {
    const result = await withRetry(() => Promise.resolve("ok"), instantRetry);
    expect(result.attempts).toBe(1);
  });

  it("un 400 no se reintenta", async () => {
    const fn = vi.fn<(attempt: number) => Promise<string>>().mockRejectedValue(httpError(400));

    await expect(withRetry(fn, instantRetry)).rejects.toMatchObject({ status: 400 });
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("relanza el último error al agotar los intentos", async () => {
    const fn = vi.fn<(attempt: number) => Promise<string>>().mockRejectedValue(httpError(529));

    await expect(withRetry(fn, instantRetry)).rejects.toMatchObject({ status: 529 });
    expect(fn).toHaveBeenCalledTimes(DEFAULT_RETRY_POLICY.maxAttempts);
  });

  it("espera lo que dice retry-after en vez del backoff calculado", async () => {
    const sleep = vi.fn<(ms: number) => Promise<void>>().mockResolvedValue(undefined);
    const error = Object.assign(httpError(429), { headers: new Headers({ "retry-after": "7" }) });
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(error)
      .mockResolvedValueOnce("ok");

    await withRetry(fn, { sleep, random: () => 0 });

    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it("notifica cada reintento por onRetry", async () => {
    const onRetry = vi.fn();
    const fn = vi
      .fn<(attempt: number) => Promise<string>>()
      .mockRejectedValueOnce(httpError(503))
      .mockResolvedValueOnce("ok");

    await withRetry(fn, { ...instantRetry, onRetry });

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(onRetry.mock.calls[0]?.[0]).toMatchObject({ attempt: 1 });
  });
});
