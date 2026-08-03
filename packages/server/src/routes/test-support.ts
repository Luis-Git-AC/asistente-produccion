import { EXAMPLE_SPRITE_SPEC, type SpriteSpec } from "@asistente/shared";
import type { Express } from "express";
import request from "supertest";
import { vi } from "vitest";
import type { AsepriteMcpPort, GenerateSpriteToolResult } from "../mcp/client.js";
import type { SseEventType } from "@asistente/shared";

/** Un evento SSE ya parseado desde el cuerpo de la respuesta. */
export interface ParsedSseEvent {
  type: SseEventType;
  data: Record<string, unknown>;
}

/**
 * Parsea el cuerpo `text/event-stream` en eventos tipados. Trabajar sobre el texto crudo del
 * stream es lo que hace que estos tests prueben el protocolo de verdad y no un mock del mismo.
 */
export function parseSse(body: string): ParsedSseEvent[] {
  const events: ParsedSseEvent[] = [];
  for (const block of body.split("\n\n")) {
    const trimmed = block.trim();
    if (trimmed === "") continue;

    const typeLine = trimmed.split("\n").find((line) => line.startsWith("event: "));
    const dataLine = trimmed.split("\n").find((line) => line.startsWith("data: "));
    if (typeLine === undefined || dataLine === undefined) continue;

    events.push({
      type: typeLine.slice("event: ".length) as SseEventType,
      data: JSON.parse(dataLine.slice("data: ".length)) as Record<string, unknown>,
    });
  }
  return events;
}

/** Lanza una petición de generación y devuelve los eventos SSE ya parseados. */
export async function postGenerate(
  app: Express,
  prompt = "un icono de gema 8x8",
): Promise<{ status: number; events: ParsedSseEvent[] }> {
  const response = await request(app).post("/api/generate").send({ prompt });
  return { status: response.status, events: parseSse(response.text) };
}

export function eventTypes(events: ParsedSseEvent[]): SseEventType[] {
  return events.map((event) => event.type);
}

export function stageNames(events: ParsedSseEvent[]): string[] {
  return events.filter((e) => e.type === "stage").map((e) => String(e.data["stage"]));
}

export interface FakeMcp extends AsepriteMcpPort {
  readonly calls: SpriteSpec[];
}

export function fakeMcp(
  behaviour: (spec: SpriteSpec) => GenerateSpriteToolResult | Promise<GenerateSpriteToolResult> = () => ({
    filePath: "/out/gem-icon.aseprite",
    spritesheetPath: "/out/gem-icon.png",
    jsonPath: "/out/gem-icon.json",
    frameCount: 1,
    warnings: [],
    asepriteStatus: "OK frames=1",
  }),
): FakeMcp {
  const calls: SpriteSpec[] = [];
  return {
    calls,
    generateSprite: vi.fn(async (spec: SpriteSpec) => {
      calls.push(spec);
      return behaviour(spec);
    }),
    describeCapabilities: vi.fn(async () => ({
      connectorAlive: true,
      asepriteVersion: "1.3.7",
      wsPort: 3001,
      outputDir: "output",
      knownLimits: [],
    })),
    close: vi.fn(async () => {}),
  };
}

export const EXAMPLE_SPEC_JSON = JSON.stringify(EXAMPLE_SPRITE_SPEC);
