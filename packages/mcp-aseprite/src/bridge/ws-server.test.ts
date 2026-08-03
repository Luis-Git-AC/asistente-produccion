import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import {
  AsepriteBridge,
  AsepriteBridgeError,
  type LuaRequestEnvelope,
} from "./ws-server.js";

/**
 * El puente se prueba contra un connector falso: un cliente `ws` que habla el mismo protocolo
 * JSON que `aseprite/connector.lua`. Ningún test de este archivo necesita Aseprite abierto.
 */

const bridges: AsepriteBridge[] = [];
const sockets: WebSocket[] = [];

/** Puerto alto y aleatorio por test, para no chocar con un puente real en el 3001. */
function randomPort(): number {
  return 40_000 + Math.floor(Math.random() * 20_000);
}

async function startBridge(options: Partial<{ timeoutMs: number }> = {}): Promise<AsepriteBridge> {
  const bridge = new AsepriteBridge({
    port: randomPort(),
    ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
    idFactory: (() => {
      let n = 0;
      return (): string => {
        n += 1;
        return `id-${String(n)}`;
      };
    })(),
  });
  bridges.push(bridge);
  await bridge.start();
  return bridge;
}

/** Connector falso. `respond` decide qué contesta a cada script recibido. */
async function connectFakeConnector(
  bridge: AsepriteBridge,
  respond: (envelope: LuaRequestEnvelope) => unknown | undefined,
): Promise<{ socket: WebSocket; received: LuaRequestEnvelope[] }> {
  const received: LuaRequestEnvelope[] = [];
  const socket = new WebSocket(`ws://127.0.0.1:${String(bridge.port)}`);
  sockets.push(socket);

  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      resolve();
    });
    socket.once("error", reject);
  });

  socket.on("message", (raw) => {
    const envelope = JSON.parse(raw.toString()) as LuaRequestEnvelope;
    received.push(envelope);
    const reply = respond(envelope);
    if (reply !== undefined) socket.send(JSON.stringify(reply));
  });

  // El servidor registra la conexión de forma asíncrona.
  await new Promise((resolve) => setTimeout(resolve, 20));
  return { socket, received };
}

afterEach(async () => {
  while (sockets.length > 0) sockets.pop()?.close();
  while (bridges.length > 0) await bridges.pop()?.stop();
});

describe("AsepriteBridge", () => {
  it("no está conectado hasta que llega el connector", async () => {
    const bridge = await startBridge();
    expect(bridge.isConnected).toBe(false);

    await connectFakeConnector(bridge, () => undefined);
    expect(bridge.isConnected).toBe(true);
  });

  it("envía Lua y resuelve con el resultado del connector", async () => {
    const bridge = await startBridge();
    const { received } = await connectFakeConnector(bridge, (envelope) => ({
      id: envelope.id,
      ok: true,
      result: "Aseprite v1.3.7",
    }));

    await expect(bridge.sendLua("return app.version")).resolves.toBe("Aseprite v1.3.7");
    expect(received).toHaveLength(1);
    expect(received[0]?.lua).toBe("return app.version");
  });

  it("correlaciona respuestas por id aunque lleguen desordenadas", async () => {
    const bridge = await startBridge();
    const pending: LuaRequestEnvelope[] = [];
    const { socket } = await connectFakeConnector(bridge, (envelope) => {
      pending.push(envelope);
      return undefined; // se responde a mano, en orden inverso
    });

    const first = bridge.sendLua("return 1");
    const second = bridge.sendLua("return 2");
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Responde primero el segundo: si el puente correlacionara por orden, se cruzarían.
    socket.send(JSON.stringify({ id: pending[1]?.id, ok: true, result: "dos" }));
    socket.send(JSON.stringify({ id: pending[0]?.id, ok: true, result: "uno" }));

    await expect(first).resolves.toBe("uno");
    await expect(second).resolves.toBe("dos");
  });

  it("propaga el mensaje real de error de Aseprite, no un genérico", async () => {
    const bridge = await startBridge();
    await connectFakeConnector(bridge, (envelope) => ({
      id: envelope.id,
      ok: false,
      error: "[mcp]:3: attempt to index a nil value (global 'app')",
    }));

    await expect(bridge.sendLua("boom")).rejects.toMatchObject({
      code: "lua_error",
      message: "[mcp]:3: attempt to index a nil value (global 'app')",
    });
  });

  it("falla con instrucciones claras si el connector no está conectado", async () => {
    const bridge = await startBridge();

    const error = (await bridge.sendLua("return 1").catch((e: unknown) => e)) as AsepriteBridgeError;

    expect(error).toBeInstanceOf(AsepriteBridgeError);
    expect(error.code).toBe("not_connected");
    expect(error.message).toMatch(/connector\.lua/u);
  });

  it("aplica timeout si el connector acepta pero nunca responde", async () => {
    const bridge = await startBridge({ timeoutMs: 60 });
    await connectFakeConnector(bridge, () => undefined);

    await expect(bridge.sendLua("return 1")).rejects.toMatchObject({ code: "timeout" });
  });

  it("acepta que el connector se reconecte tras caerse", async () => {
    const bridge = await startBridge();
    const first = await connectFakeConnector(bridge, (envelope) => ({
      id: envelope.id,
      ok: true,
      result: "primero",
    }));

    first.socket.close();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(bridge.isConnected).toBe(false);

    await connectFakeConnector(bridge, (envelope) => ({
      id: envelope.id,
      ok: true,
      result: "segundo",
    }));

    expect(bridge.isConnected).toBe(true);
    await expect(bridge.sendLua("return 1")).resolves.toBe("segundo");
  });

  it("rechaza las peticiones en vuelo al cerrar el puente", async () => {
    const bridge = await startBridge();
    await connectFakeConnector(bridge, () => undefined);

    const inFlight = bridge.sendLua("return 1");
    // El handler se engancha ANTES de cerrar: si no, el rechazo viaja un tick sin manejar
    // y Vitest lo reporta como unhandled rejection.
    const assertion = expect(inFlight).rejects.toMatchObject({ code: "closed" });
    await bridge.stop();
    await assertion;
  });

  it("ignora respuestas mal formadas sin tumbar el puente", async () => {
    const bridge = await startBridge();
    const { socket } = await connectFakeConnector(bridge, (envelope) => {
      socket.send("no soy json");
      socket.send(JSON.stringify({ id: "desconocido", ok: true, result: "huerfano" }));
      return { id: envelope.id, ok: true, result: "bien" };
    });

    await expect(bridge.sendLua("return 1")).resolves.toBe("bien");
  });
});
