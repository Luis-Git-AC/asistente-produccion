/**
 * Connector falso: habla el mismo protocolo de líneas que la extensión asistente-connector, pero sin Aseprite.
 * Sirve para validar el transporte de punta a punta en máquinas donde Aseprite no está instalado.
 *
 *   node scripts/fake-connector.mjs [puerto]
 *
 * NO es parte del producto: es una herramienta de diagnóstico del puente.
 */
import { WebSocket } from "ws";

const port = Number(process.argv[2] ?? process.env.ASEPRITE_WS_PORT ?? 3001);
const socket = new WebSocket(`ws://127.0.0.1:${port}`);

socket.on("open", () => {
  console.error(`[fake-connector] conectado a ws://127.0.0.1:${port}`);
});

socket.on("message", (raw) => {
  // Mismo parseo que connector.lua: primera línea el id, el resto el Lua. Sin JSON.
  const text = raw.toString();
  const newlineIndex = text.indexOf("\n");
  if (newlineIndex <= 0) {
    console.error(`[fake-connector] sobre inválido (${text.length} bytes)`);
    return;
  }
  const id = text.slice(0, newlineIndex);
  const lua = text.slice(newlineIndex + 1);
  console.error(`[fake-connector] recibido ${id}: ${lua.slice(0, 60).replace(/\n/g, " ")}`);

  // Responde como lo haría Aseprite para el smoke test.
  const result = lua.includes("app.version") ? "1.3.7-fake" : "OK";
  socket.send(JSON.stringify({ id, ok: true, result }));
});

socket.on("close", () => {
  console.error("[fake-connector] desconectado");
  process.exit(0);
});

socket.on("error", (error) => {
  console.error(`[fake-connector] error: ${error.message}`);
  process.exit(1);
});
