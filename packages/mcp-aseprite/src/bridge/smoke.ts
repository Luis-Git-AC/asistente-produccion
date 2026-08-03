/**
 * Smoke test del transporte. Antes de escribir una sola tool, esto tiene que pasar: si el puente
 * no conecta, todo lo que se construya encima es especulación.
 *
 *   npm run smoke -w @asistente/mcp-aseprite
 *
 * Levanta el servidor WebSocket, espera a que el connector de Aseprite se conecte, le pide
 * `app.version` y lo imprime. Falla con instrucciones concretas si Aseprite no está escuchando.
 */
import { AsepriteBridge, DEFAULT_ASEPRITE_WS_PORT } from "./ws-server.js";

const WAIT_FOR_CONNECTOR_MS = 15_000;
const POLL_INTERVAL_MS = 250;

async function waitForConnector(bridge: AsepriteBridge, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (bridge.isConnected) return true;
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
  }
  return bridge.isConnected;
}

async function main(): Promise<number> {
  const port = Number(process.env["ASEPRITE_WS_PORT"] ?? DEFAULT_ASEPRITE_WS_PORT);
  const bridge = new AsepriteBridge({
    port,
    onLog: (message) => {
      console.error(`[bridge] ${message}`);
    },
  });

  try {
    await bridge.start();
  } catch (error) {
    console.error(
      `No se pudo abrir el puerto ${String(port)}: ${(error as Error).message}\n` +
        "¿Hay otra instancia del puente corriendo? Cambia ASEPRITE_WS_PORT o cierra la otra.",
    );
    return 1;
  }

  console.error(`Escuchando en ws://127.0.0.1:${String(port)} — esperando al connector...`);

  const connected = await waitForConnector(bridge, WAIT_FOR_CONNECTOR_MS);
  if (!connected) {
    console.error(
      [
        "",
        `El connector no se conectó en ${String(WAIT_FOR_CONNECTOR_MS / 1000)} s.`,
        "",
        "Comprueba, en este orden:",
        "  1. Aseprite está abierto.",
        "  2. Has ejecutado el script: File > Scripts > connector",
        "     (si no aparece, ver aseprite/README.md para instalarlo).",
        `  3. El connector apunta al mismo puerto (${String(port)}).`,
        "",
      ].join("\n"),
    );
    await bridge.stop();
    return 1;
  }

  try {
    const version = await bridge.sendLua("return app.version");
    console.error("");
    console.error(`OK — Aseprite responde. app.version = ${version}`);
    await bridge.stop();
    return 0;
  } catch (error) {
    console.error(`El connector conectó pero falló al ejecutar Lua: ${(error as Error).message}`);
    await bridge.stop();
    return 1;
  }
}

const exitCode = await main();
process.exit(exitCode);
