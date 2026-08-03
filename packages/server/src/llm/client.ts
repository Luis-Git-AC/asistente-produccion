import Anthropic from "@anthropic-ai/sdk";

/**
 * Cliente del SDK construido desde el entorno. `new Anthropic()` resuelve la credencial por su
 * cuenta (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN` o el perfil de `ant auth login`): nunca
 * hardcodeamos la key ni la leemos a mano para no arriesgarnos a filtrarla en logs.
 *
 * `maxRetries: 0` es deliberado: los reintentos los gestiona `src/llm/retry.ts`, que necesita
 * controlar el salto de modelo y contar intentos para la telemetría (ver comentario en retry.ts).
 */
export function createAnthropicClient(options: { timeoutMs?: number } = {}): Anthropic {
  return new Anthropic({
    maxRetries: 0,
    timeout: options.timeoutMs ?? 10 * 60 * 1000,
  });
}
