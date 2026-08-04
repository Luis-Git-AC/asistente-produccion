/**
 * Siembra métricas realistas para poder ver el dashboard sin gastar API.
 *
 *   npm run seed:metrics -w @asistente/server
 *   npm run seed:metrics -w @asistente/server -- --days 14 --requests 180 --reset
 *
 * Los números imitan lo observado en producción real: el LLM domina la latencia por dos órdenes
 * de magnitud sobre el render, y el prompt caching entra en juego a partir de la segunda petición
 * con el mismo system prompt.
 */
import { randomUUID } from "node:crypto";
import { estimateCostUsd, type ModelId } from "@asistente/shared";
import { loadDotEnv, loadConfig } from "../src/config.js";
import { SqliteMetricsRepository } from "../src/telemetry/sqlite-repository.js";
import type { RequestMetrics } from "../src/telemetry/types.js";

loadDotEnv();

function arg(name: string, fallback: number): number {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return fallback;
  const value = Number(process.argv[index + 1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

const DAYS = arg("days", 7);
const REQUESTS = arg("requests", 90);
const RESET = process.argv.includes("--reset");

const PROMPTS = [
  "un icono de poción de vida de 16x16, exactamente 5 colores, estilo RPG",
  "un caballero de 32x32 con ciclo de caminata de 6 frames",
  "un tileset de hierba de 16x16 con 4 variaciones",
  "un icono de gema azul de 16x16 con brillo especular",
  "un cofre de madera de 24x24, abierto y cerrado",
  "una antorcha animada de 16x32, 4 frames de llama",
];

/** Aleatoriedad determinista: el mismo seed produce el mismo dataset. */
function makeRandom(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

const random = makeRandom(20260803);

function pick<T>(items: readonly T[]): T {
  return items[Math.floor(random() * items.length)] as T;
}

function between(min: number, max: number): number {
  return Math.round(min + random() * (max - min));
}

function main(): void {
  const config = loadConfig();
  const repository = new SqliteMetricsRepository({ dbPath: config.dbPath });

  if (RESET) {
    // Sólo se usa desde el seed; no justifica un método en la interfaz del repositorio.
    process.stderr.write("Aviso: --reset no borra datos existentes; usa un DB_PATH distinto.\n");
  }

  const now = Date.now();
  const spanMs = DAYS * 86_400_000;
  // El prompt caching se activa a partir de la segunda petición con el mismo prefijo.
  const seenPrompts = new Set<string>();
  let written = 0;

  for (let i = 0; i < REQUESTS; i += 1) {
    const createdAt = Math.round(now - spanMs + (spanMs * i) / REQUESTS + between(0, 60_000));
    const prompt = pick(PROMPTS);
    const promptHash = `${"0".repeat(56)}${(PROMPTS.indexOf(prompt) + 1).toString().padStart(8, "0")}`;

    // ~1 de cada 5 repeticiones sale de caché.
    const isCacheHit = seenPrompts.has(promptHash) && random() < 0.35;
    const model: ModelId = random() < 0.72 ? "claude-opus-5" : "claude-sonnet-5";
    const fellBack = !isCacheHit && random() < 0.06;
    const attempts = fellBack ? between(3, 5) : 1;
    const failed = !isCacheHit && random() < 0.05;

    const prefixCached = seenPrompts.has(promptHash);
    const inputTokens = isCacheHit ? 0 : between(30, 90);
    const outputTokens = isCacheHit ? 0 : between(3200, 11_000);
    const cacheReadTokens = isCacheHit || !prefixCached ? 0 : 3239;
    const cacheCreationTokens = isCacheHit || prefixCached ? 0 : 3239;
    seenPrompts.add(promptHash);

    const costUsd = isCacheHit
      ? 0
      : estimateCostUsd({ model, inputTokens, outputTokens, cacheReadTokens, cacheCreationTokens });

    // El LLM domina: decenas de segundos frente a milisegundos de render.
    const llmMs = isCacheHit ? 0 : between(28_000, 110_000);
    const validateMs = between(0, 2);
    const renderMs = failed ? 0 : between(12, 40);

    const metrics: RequestMetrics = {
      requestId: randomUUID(),
      promptHash,
      promptPreview: prompt,
      model,
      attempts,
      fellBack,
      cache: isCacheHit ? "hit" : "miss",
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      costUsd,
      llmMs,
      validateMs,
      renderMs,
      totalMs: llmMs + validateMs + renderMs + between(2, 20),
      status: failed ? "error" : "ok",
      errorCode: failed ? pick(["mcp_tool_error", "invalid_spec", "api_rate_limited"]) : null,
      filePath: failed ? null : `output/${prompt.slice(0, 12).replace(/\s+/gu, "-")}.aseprite`,
      spritesheetPath: failed ? null : `output/${prompt.slice(0, 12).replace(/\s+/gu, "-")}.png`,
      createdAt,
    };

    repository.record(metrics);
    written += 1;
  }

  repository.close();

  process.stderr.write(
    `\nSembradas ${String(written)} peticiones en ${String(DAYS)} días.\n` +
      `Base: ${config.dbPath}\n\n` +
      "Arranca el servidor y abre el dashboard:\n" +
      "  npm run dev -w @asistente/server\n" +
      "  npm run dev -w @asistente/web   ->  http://localhost:5173/#/dashboard\n\n",
  );
}

main();
