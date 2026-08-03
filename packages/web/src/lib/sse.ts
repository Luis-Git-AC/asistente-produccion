import type { SseEvent, SseEventType } from "@asistente/shared";

/**
 * Cliente SSE tipado sobre `fetch` + `ReadableStream`.
 *
 * No se usa `EventSource` porque sólo sabe hacer GET, y aquí el prompt viaja en el cuerpo de un
 * POST. A cambio hay que parsear el protocolo a mano, que es lo que hace `parseSseChunk`.
 */

export class SseClientError extends Error {
  readonly code: "http_error" | "network" | "aborted" | "malformed";

  constructor(code: SseClientError["code"], message: string) {
    super(message);
    this.name = "SseClientError";
    this.code = code;
  }
}

const KNOWN_EVENT_TYPES = new Set<string>([
  "stage",
  "spec_delta",
  "spec_final",
  "render_progress",
  "done",
  "error",
]);

function isKnownEventType(value: string): value is SseEventType {
  return KNOWN_EVENT_TYPES.has(value);
}

/**
 * Parsea los bloques completos de un buffer SSE y devuelve los eventos junto al resto sin
 * terminar. El resto se conserva porque un chunk de red puede partir un evento por la mitad:
 * asumir que cada chunk trae eventos enteros es el fallo clásico de un parser SSE casero.
 */
export function parseSseChunk(buffer: string): { events: SseEvent[]; rest: string } {
  const events: SseEvent[] = [];
  const blocks = buffer.split("\n\n");
  // El último trozo puede estar incompleto: se devuelve para concatenar con el siguiente chunk.
  const rest = blocks.pop() ?? "";

  for (const block of blocks) {
    const trimmed = block.trim();
    if (trimmed === "") continue;

    let eventType: string | undefined;
    const dataLines: string[] = [];

    for (const line of trimmed.split("\n")) {
      if (line.startsWith("event:")) eventType = line.slice("event:".length).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice("data:".length).trim());
      // Los comentarios (`: keep-alive`) se ignoran por diseño.
    }

    if (eventType === undefined || !isKnownEventType(eventType) || dataLines.length === 0) {
      continue;
    }

    try {
      const data = JSON.parse(dataLines.join("\n")) as unknown;
      events.push({ type: eventType, data } as SseEvent);
    } catch {
      // Un evento ilegible no debe tumbar el stream: se descarta y se sigue.
      continue;
    }
  }

  return { events, rest };
}

export interface StreamGenerationOptions {
  prompt: string;
  signal: AbortSignal;
  onEvent: (event: SseEvent) => void;
  baseUrl?: string;
}

/**
 * Abre el stream de generación y entrega cada evento según llega.
 * Resuelve cuando el servidor cierra el stream; lanza si la conexión falla.
 */
export async function streamGeneration(options: StreamGenerationOptions): Promise<void> {
  const baseUrl = options.baseUrl ?? "";

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/api/generate`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "text/event-stream" },
      body: JSON.stringify({ prompt: options.prompt }),
      signal: options.signal,
    });
  } catch (error) {
    if (options.signal.aborted) throw new SseClientError("aborted", "Generación cancelada.");
    throw new SseClientError(
      "network",
      `No se pudo contactar con el servidor: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    // El servidor rechaza antes de abrir el stream (p. ej. prompt inválido): el cuerpo es JSON.
    let message = `El servidor respondió ${String(response.status)}.`;
    try {
      const body = (await response.json()) as { message?: string };
      if (typeof body.message === "string") message = body.message;
    } catch {
      /* cuerpo no-JSON: nos quedamos con el mensaje genérico */
    }
    throw new SseClientError("http_error", message);
  }

  if (response.body === null) {
    throw new SseClientError("malformed", "La respuesta no traía cuerpo.");
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += value;
      const { events, rest } = parseSseChunk(buffer);
      buffer = rest;
      for (const event of events) options.onEvent(event);
    }

    // Un último evento puede quedar sin el `\n\n` final si el servidor cerró justo después.
    const { events } = parseSseChunk(`${buffer}\n\n`);
    for (const event of events) options.onEvent(event);
  } catch (error) {
    if (options.signal.aborted) throw new SseClientError("aborted", "Generación cancelada.");
    throw new SseClientError(
      "network",
      `El stream se cortó: ${error instanceof Error ? error.message : String(error)}`,
    );
  } finally {
    reader.releaseLock();
  }
}
