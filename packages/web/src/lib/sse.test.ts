import { describe, expect, it } from "vitest";
import { parseSseChunk } from "./sse.js";

describe("parseSseChunk", () => {
  it("parsea un evento completo", () => {
    const { events, rest } = parseSseChunk('event: stage\ndata: {"stage":"llm","elapsedMs":12}\n\n');

    expect(events).toEqual([{ type: "stage", data: { stage: "llm", elapsedMs: 12 } }]);
    expect(rest).toBe("");
  });

  it("parsea varios eventos de un mismo chunk", () => {
    const raw =
      'event: stage\ndata: {"stage":"cache","elapsedMs":1}\n\n' +
      'event: spec_delta\ndata: {"text":"{"}\n\n';

    const { events } = parseSseChunk(raw);

    expect(events.map((event) => event.type)).toEqual(["stage", "spec_delta"]);
  });

  it("conserva el evento incompleto para el siguiente chunk", () => {
    // Es el caso que rompe a un parser ingenuo: la red parte el evento por la mitad.
    const first = parseSseChunk('event: stage\ndata: {"stage":"llm","elapsedMs":5}\n\nevent: spec_de');

    expect(first.events).toHaveLength(1);
    expect(first.rest).toBe("event: spec_de");

    const second = parseSseChunk(`${first.rest}lta\ndata: {"text":"hola"}\n\n`);

    expect(second.events).toEqual([{ type: "spec_delta", data: { text: "hola" } }]);
  });

  it("descarta un evento con JSON ilegible sin tumbar el resto", () => {
    const raw =
      "event: spec_delta\ndata: {roto\n\n" + 'event: done\ndata: {"requestId":"x"}\n\n';

    const { events } = parseSseChunk(raw);

    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("done");
  });

  it("ignora tipos de evento desconocidos", () => {
    const { events } = parseSseChunk('event: inventado\ndata: {"a":1}\n\n');

    expect(events).toHaveLength(0);
  });

  it("ignora comentarios de keep-alive", () => {
    const { events } = parseSseChunk(': keep-alive\n\nevent: stage\ndata: {"stage":"llm"}\n\n');

    expect(events).toHaveLength(1);
  });

  it("soporta data multilínea", () => {
    const { events } = parseSseChunk('event: spec_delta\ndata: {"text":\ndata: "roto"}\n\n');

    expect(events[0]?.data).toEqual({ text: "roto" });
  });

  it("un buffer vacío no produce eventos", () => {
    expect(parseSseChunk("").events).toHaveLength(0);
    expect(parseSseChunk("\n\n").events).toHaveLength(0);
  });
});
