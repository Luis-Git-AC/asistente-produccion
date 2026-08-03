#!/usr/bin/env node
/**
 * Punto de entrada ejecutable del servidor.
 *
 * Igual que en `@asistente/mcp-aseprite`, es un fichero aparte en vez de un guard
 * `import.meta.url === process.argv[1]` dentro de `app.ts`: ese guard falla en silencio con tsx
 * y en Windows, y un servidor que no arranca sin decir nada es lo más caro de diagnosticar.
 */
import { createApp, createLogger } from "./app.js";
import { ResponseCache } from "./cache/response-cache.js";
import { ConfigError, loadConfig } from "./config.js";
import { createAnthropicClient } from "./llm/client.js";
import { createSdkAnthropicPort } from "./llm/anthropic-port.js";
import { simulate5xxEnabled, withSimulatedPrimaryFailure } from "./llm/fallback.js";
import { AsepriteMcpClient } from "./mcp/client.js";
import { SqliteMetricsRepository } from "./telemetry/sqlite-repository.js";

const log = createLogger();

function main(): void {
  let config;
  try {
    config = loadConfig({ requireApiKey: true });
  } catch (error) {
    if (error instanceof ConfigError) {
      // Fail fast y legible: sin key no hay nada que hacer, y el mensaje dice cómo arreglarlo.
      process.stderr.write(`\n${error.message}\n\n`);
      process.exit(1);
    }
    throw error;
  }

  const metrics = new SqliteMetricsRepository({ dbPath: config.dbPath });
  const cache = new ResponseCache({
    dbPath: config.dbPath,
    ttlSeconds: config.cacheTtlSeconds,
  });

  const sdkPort = createSdkAnthropicPort(createAnthropicClient());
  const port = withSimulatedPrimaryFailure(sdkPort, {
    enabled: config.simulate5xx || simulate5xxEnabled(),
  });

  const mcp = new AsepriteMcpClient({
    env: {
      ASEPRITE_WS_PORT: String(config.asepriteWsPort),
      ASEPRITE_OUTPUT_DIR: config.asepriteOutputDir,
    },
    onLog: (message) => {
      log(message, { component: "mcp" });
    },
  });

  const app = createApp({
    port,
    mcp,
    metrics,
    cache,
    corsOrigins: config.corsOrigins,
    onLog: log,
  });

  const server = app.listen(config.port, () => {
    log("servidor escuchando", { port: config.port, simulate5xx: config.simulate5xx });
  });

  const shutdown = (signal: string): void => {
    log("apagando", { signal });
    server.close(() => {
      void mcp.close().finally(() => {
        metrics.close();
        cache.close();
        process.exit(0);
      });
    });
  };

  process.on("SIGINT", () => {
    shutdown("SIGINT");
  });
  process.on("SIGTERM", () => {
    shutdown("SIGTERM");
  });
}

main();
