/**
 * Diagnóstico end-to-end de la cadena MCP → Lua → Aseprite, SIN pasar por el modelo.
 *
 *   npm run render:example -w @asistente/server
 *
 * Usa el fixture `EXAMPLE_SPRITE_SPEC` de @asistente/shared, así que no gasta tokens ni necesita
 * ANTHROPIC_API_KEY. Es la forma de aislar si un fallo viene de Aseprite o del LLM.
 *
 * Lanza el MCP server real (que a su vez levanta el puente WebSocket), espera a que el connector
 * de Aseprite se conecte, y le pide que materialice el sprite.
 */
import { EXAMPLE_SPRITE_SPEC } from "@asistente/shared";
import { loadDotEnv } from "../src/config.js";
import { AsepriteMcpClient } from "../src/mcp/client.js";

// Para respetar ASEPRITE_WS_PORT / ASEPRITE_OUTPUT_DIR del .env. No necesita credencial.
loadDotEnv();

const WAIT_FOR_CONNECTOR_MS = 60_000;
const POLL_INTERVAL_MS = 1000;

const wsPort = process.env["ASEPRITE_WS_PORT"] ?? "3001";
const outputDir = process.env["ASEPRITE_OUTPUT_DIR"] ?? "output";

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

async function main(): Promise<number> {
  const client = new AsepriteMcpClient({
    env: { ASEPRITE_WS_PORT: wsPort, ASEPRITE_OUTPUT_DIR: outputDir },
    onLog: (message) => {
      log(`[mcp] ${message}`);
    },
  });

  try {
    const tools = await client.listToolNames();
    log(`Tools disponibles: ${tools.sort().join(", ")}`);
    log("");
    log(`Puente WebSocket levantado en ws://127.0.0.1:${wsPort}`);
    log("Ahora, en Aseprite: File > Scripts > connector");
    log("");

    const deadline = Date.now() + WAIT_FOR_CONNECTOR_MS;
    let capabilities = await client.describeCapabilities();
    while (!capabilities.connectorAlive && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
      capabilities = await client.describeCapabilities();
    }

    if (!capabilities.connectorAlive) {
      log("El connector no se conectó a tiempo.");
      log(`Detalle: ${capabilities.detail ?? "(sin detalle)"}`);
      log("");
      log("Comprueba: Aseprite abierto · script ejecutado · mismo puerto en ambos lados.");
      log("Ver aseprite/README.md");
      return 1;
    }

    log(`Connector vivo. Aseprite ${capabilities.asepriteVersion ?? "(versión desconocida)"}`);
    log("");
    log(`Generando '${EXAMPLE_SPRITE_SPEC.name}' (${EXAMPLE_SPRITE_SPEC.canvas.width}x${EXAMPLE_SPRITE_SPEC.canvas.height}, ${String(EXAMPLE_SPRITE_SPEC.frames.length)} frame(s))...`);

    const startedAt = Date.now();
    const result = await client.generateSprite(EXAMPLE_SPRITE_SPEC);
    const elapsedMs = Date.now() - startedAt;

    log("");
    log(`OK en ${String(elapsedMs)} ms`);
    log(`  .aseprite    : ${result.filePath}`);
    log(`  spritesheet  : ${result.spritesheetPath}`);
    log(`  metadatos    : ${result.jsonPath}`);
    log(`  frames       : ${String(result.frameCount)}`);
    log(`  Aseprite dijo: ${result.asepriteStatus}`);
    if (result.warnings.length > 0) {
      log(`  avisos       : ${result.warnings.join(" | ")}`);
    }
    log("");
    log("Abre el PNG para comprobar el resultado a ojo.");
    return 0;
  } catch (error) {
    log("");
    log(`FALLO: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  } finally {
    await client.close();
  }
}

process.exit(await main());
