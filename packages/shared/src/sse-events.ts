import type { SpriteSpec } from "./schema/sprite-spec.js";

/**
 * Contrato de eventos SSE entre `@asistente/server` y `@asistente/web`.
 *
 * Vive en `shared` porque es exactamente eso: un contrato entre dos paquetes. Si viviera en el
 * servidor, la web tendría que redefinir los tipos y los dos lados derivarían en silencio.
 */

export const GENERATION_STAGES = ["cache", "llm", "validate", "render", "export"] as const;
export type GenerationStage = (typeof GENERATION_STAGES)[number];

/** Métricas de una generación, tal como llegan en el evento `done`. */
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

export interface DonePayload {
  requestId: string;
  filePath: string | null;
  spritesheetPath: string | null;
  /** URL servible del spritesheet (`/api/assets/<fichero>`), lista para un `<img>`. */
  spritesheetUrl: string | null;
  warnings: string[];
  metrics: DoneMetrics;
}

export interface ErrorPayload {
  code: string;
  message: string;
  retryable: boolean;
}

export type SseEvent =
  | { type: "stage"; data: { stage: GenerationStage; elapsedMs: number } }
  | { type: "spec_delta"; data: { text: string } }
  | { type: "spec_final"; data: { spec: SpriteSpec } }
  | { type: "render_progress"; data: { frame: number; total: number } }
  | { type: "done"; data: DonePayload }
  | { type: "error"; data: ErrorPayload };

export type SseEventType = SseEvent["type"];

/** Extrae el payload de un tipo de evento concreto. */
export type SseEventData<T extends SseEventType> = Extract<SseEvent, { type: T }>["data"];
