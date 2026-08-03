import type { BetaMessage } from "@anthropic-ai/sdk/resources/beta/messages/messages";
import { describe, expect, it } from "vitest";
import { extractText, SERVER_SIDE_FALLBACK_BETA, toSpecMessageResponse } from "./anthropic-port.js";
import { LlmError, LlmRefusalError } from "./types.js";

function betaMessage(overrides: Partial<BetaMessage>): BetaMessage {
  return {
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5",
    content: [{ type: "text", text: "{}", citations: null }],
    stop_reason: "end_turn",
    stop_sequence: null,
    stop_details: null,
    usage: {
      input_tokens: 10,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    ...overrides,
  } as BetaMessage;
}

describe("toSpecMessageResponse", () => {
  it("devuelve texto y usage normalizados en una respuesta correcta", () => {
    const message = betaMessage({
      content: [
        { type: "text", text: '{"a":', citations: null },
        { type: "text", text: "1}", citations: null },
      ],
      usage: {
        input_tokens: 100,
        output_tokens: 200,
        cache_read_input_tokens: 4096,
        cache_creation_input_tokens: 1024,
      },
    } as Partial<BetaMessage>);

    const result = toSpecMessageResponse(message, "claude-opus-5");

    expect(result.text).toBe('{"a":1}');
    expect(result.usage).toEqual({
      input_tokens: 100,
      output_tokens: 200,
      cache_read_input_tokens: 4096,
      cache_creation_input_tokens: 1024,
    });
    expect(result.servedByModel).toBe("claude-opus-5");
  });

  it("un refusal con content vacío no revienta y se propaga como LlmRefusalError", () => {
    // El caso que rompe el código ingenuo: leer content[0].text daría TypeError.
    const message = betaMessage({
      content: [],
      stop_reason: "refusal",
      stop_details: {
        type: "refusal",
        category: "cyber",
        explanation: "declinado por política",
        fallback_credit_token: null,
        fallback_has_prefill_claim: null,
        recommended_model: null,
      },
    } as Partial<BetaMessage>);

    let caught: unknown;
    try {
      toSpecMessageResponse(message, "claude-opus-5");
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(LlmRefusalError);
    expect(caught).not.toBeInstanceOf(TypeError);
    expect(caught).toMatchObject({ code: "refusal", category: "cyber", modelId: "claude-opus-5" });
  });

  it("un refusal con stop_details null sigue siendo un LlmRefusalError", () => {
    // stop_details es informativo y puede ser null incluso en un refusal: la rama la decide
    // stop_reason, nunca stop_details.
    const message = betaMessage({ content: [], stop_reason: "refusal", stop_details: null });

    const act = (): unknown => toSpecMessageResponse(message, "claude-sonnet-5");

    expect(act).toThrow(LlmRefusalError);
    expect(act).toThrow(/claude-sonnet-5/u);
  });

  it("un refusal con contenido parcial también se rechaza en vez de devolver texto a medias", () => {
    const message = betaMessage({
      content: [{ type: "text", text: '{"kind":"spr', citations: null }],
      stop_reason: "refusal",
      stop_details: null,
    } as Partial<BetaMessage>);

    expect(() => toSpecMessageResponse(message, "claude-opus-5")).toThrow(LlmRefusalError);
  });

  it("una respuesta sin bloques de texto da un error tipado, no una cadena vacía", () => {
    const message = betaMessage({ content: [], stop_reason: "end_turn" });

    expect(() => toSpecMessageResponse(message, "claude-opus-5")).toThrow(LlmError);
    expect(() => toSpecMessageResponse(message, "claude-opus-5")).toThrow(/sin contenido/u);
  });

  it("reporta el modelo que sirvió la respuesta, que puede diferir por fallback server-side", () => {
    const message = betaMessage({ model: "claude-opus-4-8" });

    expect(toSpecMessageResponse(message, "claude-opus-5").servedByModel).toBe("claude-opus-4-8");
  });
});

describe("extractText", () => {
  it("ignora los bloques que no son de texto", () => {
    const message = betaMessage({
      content: [
        { type: "thinking", thinking: "", signature: "sig" },
        { type: "text", text: "hola", citations: null },
      ],
    } as Partial<BetaMessage>);

    expect(extractText(message)).toBe("hola");
  });
});

describe("SERVER_SIDE_FALLBACK_BETA", () => {
  it("es la beta de la forma escalar fallbacks: 'default'", () => {
    // La forma en array usa -2026-06-01; cruzar cabecera y forma devuelve 400.
    expect(SERVER_SIDE_FALLBACK_BETA).toBe("server-side-fallback-2026-07-01");
  });
});
