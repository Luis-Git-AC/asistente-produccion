import type { ModelId } from "@asistente/shared";
import type { EvalCase } from "./cases.js";
import { loadFixture, sha256, writeFixture } from "./fixtures.js";
import type { EvalUsage } from "./types.js";

/** Lo que el runner necesita de una respuesta, venga de un fixture o de la API. */
export interface CaseResponse {
  rawText: string;
  usage: EvalUsage;
  latencyMs: number;
  servedByModel: string;
  source: "fixture" | "live";
  /** Fallo de transporte. Si no es `null`, `rawText` está vacío. */
  transportError: string | null;
}

export interface ResponseSource {
  readonly kind: "fixtures" | "live";
  fetch(evalCase: EvalCase, model: ModelId): Promise<CaseResponse>;
}

/**
 * Fuente offline. Un fixture que falta o que quedó obsoleto **lanza**: no se degrada a "caso
 * omitido". Una suite que se salta en silencio los casos sin fixture acaba midiendo tres casos
 * y reportando verde.
 */
export const fixtureSource: ResponseSource = {
  kind: "fixtures",
  fetch(evalCase, model) {
    const fixture = loadFixture(evalCase, model);
    return Promise.resolve({
      rawText: fixture.responseText,
      usage: fixture.usage,
      latencyMs: fixture.latencyMs,
      servedByModel: fixture.servedByModel,
      source: "fixture",
      transportError: null,
    });
  },
};

export interface LiveSourceOptions {
  /** Graba cada respuesta en `evals/fixtures/`, sobrescribiendo la anterior. */
  record: boolean;
  maxTokens?: number;
}

/**
 * Fuente en vivo. Reutiliza el puerto real del servidor (`createSdkAnthropicPort`) en vez de
 * hablar con el SDK por su cuenta: si la eval no manda exactamente las mismas betas, el mismo
 * `effort` y el mismo system prompt que producción, deja de medir producción.
 *
 * El import es dinámico para que `--fixtures` no cargue nunca el SDK, Express ni SQLite: el
 * criterio de la fase es que la corrida offline termine en menos de 30 s.
 */
export async function createLiveSource(options: LiveSourceOptions): Promise<ResponseSource> {
  const [{ spriteSpecJsonSchema }, server] = await Promise.all([
    import("@asistente/shared"),
    import("@asistente/server"),
  ]);

  const port = server.createSdkAnthropicPort(server.createAnthropicClient());
  // `z.toJSONSchema` emite `$schema` en la raíz y la API no lo espera dentro de
  // `output_config.format.schema`. Mismo recorte que hace `generate.ts` en producción.
  const { $schema: _dialect, ...jsonSchema } = spriteSpecJsonSchema();

  return {
    kind: "live",
    async fetch(evalCase, model) {
      const startedAt = Date.now();
      try {
        const response = await port.createSpecMessage({
          model,
          systemPrompt: server.SPRITE_SPEC_SYSTEM_PROMPT,
          userPrompt: evalCase.prompt,
          jsonSchema,
          maxTokens: options.maxTokens ?? server.DEFAULT_MAX_TOKENS,
          effort: server.DEFAULT_EFFORT,
        });
        const latencyMs = Date.now() - startedAt;

        if (options.record) {
          writeFixture({
            caseId: evalCase.id,
            model,
            servedByModel: response.servedByModel,
            promptSha256: sha256(evalCase.prompt),
            origin: "recorded",
            recordedAt: new Date().toISOString(),
            latencyMs,
            usage: response.usage,
            responseText: response.text,
          });
        }

        return {
          rawText: response.text,
          usage: response.usage,
          latencyMs,
          servedByModel: response.servedByModel,
          source: "live",
          transportError: null,
        };
      } catch (error) {
        return {
          rawText: "",
          usage: {
            input_tokens: 0,
            output_tokens: 0,
            cache_read_input_tokens: 0,
            cache_creation_input_tokens: 0,
          },
          latencyMs: Date.now() - startedAt,
          servedByModel: model,
          source: "live",
          transportError: (error as Error).message,
        };
      }
    },
  };
}
