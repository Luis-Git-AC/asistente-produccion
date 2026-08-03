/**
 * Connector falso: habla el mismo protocolo JSON que `aseprite/connector.lua` pero sin Aseprite.
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
  let envelope;
  try {
    envelope = JSON.parse(raw.toString());
  } catch {
    return;
  }
  console.error(`[fake-connector] recibido ${envelope.id}: ${envelope.lua.slice(0, 60)}`);

  // Responde como lo haría Aseprite para el smoke test.
  const result = envelope.lua.includes("app.version") ? "1.3.7-fake" : "OK";
  socket.send(JSON.stringify({ id: envelope.id, ok: true, result }));
});

socket.on("close", () => {
  console.error("[fake-connector] desconectado");
  process.exit(0);
});

socket.on("error", (error) => {
  console.error(`[fake-connector] error: ${error.message}`);
  process.exit(1);
});
