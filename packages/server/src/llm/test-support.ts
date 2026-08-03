import { EXAMPLE_SPRITE_SPEC, type ModelId, type SpriteSpec } from "@asistente/shared";
import type { AnthropicPort, SpecMessageRequest, SpecMessageResponse } from "./anthropic-port.js";
import type { LlmUsage } from "./types.js";

/** Error con `status`, equivalente a lo que expone el SDK para un fallo HTTP. */
export function httpError(status: number, message = `HTTP ${status}`): Error & { status: number } {
  const error = new Error(message) as Error & { status: number };
  error.status = status;
  return error;
}

export function usage(overrides: Partial<LlmUsage> = {}): LlmUsage {
  return {
    input_tokens: 1000,
    output_tokens: 2000,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0,
    ...overrides,
  };
}

export function specResponse(
  spec: SpriteSpec = EXAMPLE_SPRITE_SPEC,
  overrides: Partial<SpecMessageResponse> = {},
): SpecMessageResponse {
  return {
    text: JSON.stringify(spec),
    usage: usage(),
    servedByModel: "claude-opus-5",
    ...overrides,
  };
}

export interface FakePort extends AnthropicPort {
  /** Peticiones recibidas, en orden. Permite afirmar "cero llamadas al SDK". */
  readonly calls: SpecMessageRequest[];
}

/**
 * Puerto de prueba guiado por una lista de comportamientos, uno por invocación. El último
 * comportamiento se repite si se llama más veces de las previstas.
 */
export function fakePort(
  behaviours: ReadonlyArray<SpecMessageResponse | Error | ((req: SpecMessageRequest) => SpecMessageResponse)>,
): FakePort {
  const calls: SpecMessageRequest[] = [];
  return {
    calls,
    createSpecMessage(request: SpecMessageRequest): Promise<SpecMessageResponse> {
      calls.push(request);
      const behaviour = behaviours[Math.min(calls.length - 1, behaviours.length - 1)];
      if (behaviour === undefined) {
        return Promise.reject(new Error("fakePort sin comportamientos configurados"));
      }
      if (behaviour instanceof Error) return Promise.reject(behaviour);
      if (typeof behaviour === "function") return Promise.resolve(behaviour(request));
      return Promise.resolve(behaviour);
    },
  };
}

/** Opciones de reintento deterministas y sin esperas reales, para tests. */
export const instantRetry = {
  sleep: (): Promise<void> => Promise.resolve(),
  random: (): number => 0,
} as const;

export const TEST_CHAIN: readonly ModelId[] = ["claude-opus-5", "claude-sonnet-5"];
