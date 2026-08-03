import type { Response } from "express";
import type { SpriteSpec } from "@asistente/shared";

/**
 * Eventos SSE tipados. El contrato entre servidor y UI vive aquí, en un sitio, para que el
 * frontend (fase 05) importe estos tipos en vez de redefinirlos.
 */

export type GenerationStage = "cache" | "llm" | "validate" | "render" | "export";

export interface DoneMetrics {
  model: string;
  cache: "hit" | "miss";
  attempts: number;
  fellBack: boolean;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  costUsd: number;
  llmMs: number;
  validateMs: number;
  renderMs: number;
  totalMs: number;
}

export type SseEvent =
  | { type: "stage"; data: { stage: GenerationStage; elapsedMs: number } }
  | { type: "spec_delta"; data: { text: string } }
  | { type: "spec_final"; data: { spec: SpriteSpec } }
  | { type: "render_progress"; data: { frame: number; total: number } }
  | {
      type: "done";
      data: {
        requestId: string;
        filePath: string | null;
        spritesheetPath: string | null;
        warnings: string[];
        metrics: DoneMetrics;
      };
    }
  | { type: "error"; data: { code: string; message: string; retryable: boolean } };

export type SseEventType = SseEvent["type"];

/**
 * Escritor SSE. Encapsula el formato del protocolo para que las rutas no manipulen `\n\n`
 * a mano, y lleva la cuenta de si el stream sigue abierto.
 */
export class SseWriter {
  readonly #res: Response;
  /** El cliente colgó: dejamos de escribir, pero aún hay que terminar la respuesta. */
  #clientGone = false;
  /** Ya se llamó a `res.end()`. */
  #ended = false;

  constructor(res: Response) {
    this.#res = res;
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Evita que un proxy intermedio acumule el stream y lo entregue de golpe.
      "X-Accel-Buffering": "no",
    });
    res.flushHeaders?.();
  }

  get isClientGone(): boolean {
    return this.#clientGone;
  }

  get isEnded(): boolean {
    return this.#ended;
  }

  send(event: SseEvent): void {
    if (this.#clientGone || this.#ended || this.#res.writableEnded) return;
    this.#res.write(`event: ${event.type}\ndata: ${JSON.stringify(event.data)}\n\n`);
  }

  /**
   * Termina la respuesta. Idempotente.
   *
   * Se llama SIEMPRE, también cuando el cliente ya se fue: marcar el stream como "cerrado por el
   * cliente" y no llamar a `res.end()` deja la respuesta colgada para siempre. Son dos estados
   * distintos y hay que tratarlos por separado.
   */
  close(): void {
    if (this.#ended) return;
    this.#ended = true;
    if (!this.#res.writableEnded) this.#res.end();
  }

  /** El cliente colgó: dejamos de escribir. NO termina la respuesta; de eso se encarga `close()`. */
  markClientGone(): void {
    this.#clientGone = true;
  }
}

/** Parser del parámetro `window` de las métricas: `1h`, `24h`, `7d`, `30d`. */
export function parseWindowMs(raw: string | undefined, fallbackMs: number): number {
  if (raw === undefined || raw.trim() === "") return fallbackMs;
  const match = /^(\d+)([hdm])$/u.exec(raw.trim().toLowerCase());
  if (match === null) return fallbackMs;

  const amount = Number(match[1]);
  const unit = match[2];
  const multiplier = unit === "m" ? 60_000 : unit === "h" ? 3_600_000 : 86_400_000;
  return amount * multiplier;
}
