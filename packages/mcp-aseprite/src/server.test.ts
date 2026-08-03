import { EXAMPLE_SPRITE_SPEC } from "@asistente/shared";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { rmSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import type { AsepriteBridge } from "./bridge/ws-server.js";
import { AsepriteBridgeError } from "./bridge/ws-server.js";
import { createMcpServer } from "./server.js";

/**
 * Prueba el servidor MCP de verdad, contra un cliente real, sobre un transporte en memoria.
 * No lanza procesos ni necesita Aseprite.
 */

// Bajo `output/`, que ya está en .gitignore: si un run se cae, no deja basura sin rastrear.
const OUT_DIR = resolve(process.cwd(), "output", "mcp-test");
const closers: Array<() => Promise<void>> = [];

function fakeBridge(
  behaviour: (lua: string) => string = () => "OK frames=1 tags=1 palette=5",
  isConnected = true,
): { bridge: AsepriteBridge; sent: string[] } {
  const sent: string[] = [];
  const bridge = {
    port: 3001,
    isConnected,
    sendLua: vi.fn(async (lua: string) => {
      sent.push(lua);
      return behaviour(lua);
    }),
  } as unknown as AsepriteBridge;
  return { bridge, sent };
}

async function connectClient(bridge: AsepriteBridge): Promise<Client> {
  const server = createMcpServer({ bridge, outputDir: OUT_DIR });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  closers.push(async () => {
    await client.close();
    await server.close();
  });
  return client;
}

afterEach(async () => {
  while (closers.length > 0) await closers.pop()?.();
});

afterAll(() => {
  rmSync(OUT_DIR, { recursive: true, force: true });
});

describe("createMcpServer", () => {
  it("expone exactamente las tres tools de la fase", async () => {
    const client = await connectClient(fakeBridge().bridge);

    const { tools } = await client.listTools();

    expect(tools.map((tool) => tool.name).sort()).toEqual([
      "describe_capabilities",
      "export_spritesheet",
      "generate_sprite",
    ]);
  });

  it("deriva el input_schema de generate_sprite del Zod de shared", async () => {
    const client = await connectClient(fakeBridge().bridge);

    const { tools } = await client.listTools();
    const generate = tools.find((tool) => tool.name === "generate_sprite");

    // Un único parámetro `spec` cuyo schema viene del contrato compartido, sin duplicar campos.
    expect(Object.keys(generate?.inputSchema.properties ?? {})).toEqual(["spec"]);
    const specSchema = generate?.inputSchema.properties?.["spec"] as
      | { properties?: Record<string, unknown> }
      | undefined;
    expect(Object.keys(specSchema?.properties ?? {})).toEqual(
      expect.arrayContaining(["schemaVersion", "canvas", "palette", "frames", "tags", "export"]),
    );
  });

  it("generate_sprite materializa el spec con un solo script", async () => {
    const { bridge, sent } = fakeBridge();
    const client = await connectClient(bridge);

    const result = await client.callTool({
      name: "generate_sprite",
      arguments: { spec: EXAMPLE_SPRITE_SPEC },
    });

    expect(result.isError).toBeFalsy();
    expect(sent).toHaveLength(1);

    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
      frameCount: number;
      filePath: string;
    };
    expect(payload.frameCount).toBe(1);
    expect(payload.filePath).toContain("gem-icon.aseprite");
  });

  it("rechaza un spec que no valida, antes de tocar Aseprite", async () => {
    const { bridge, sent } = fakeBridge();
    const client = await connectClient(bridge);

    const broken = { ...EXAMPLE_SPRITE_SPEC, canvas: { width: 13, height: 13 } };
    const result = await client.callTool({
      name: "generate_sprite",
      arguments: { spec: broken },
    });

    expect(result.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });

  it("un fallo de Lua vuelve como is_error con el mensaje real de Aseprite", async () => {
    const { bridge } = fakeBridge(() => {
      throw new AsepriteBridgeError("lua_error", "[mcp]:12: bad argument #1 to 'drawPixel'");
    });
    const client = await connectClient(bridge);

    const result = await client.callTool({
      name: "generate_sprite",
      arguments: { spec: EXAMPLE_SPRITE_SPEC },
    });

    expect(result.isError).toBe(true);
    expect((result.content as Array<{ text: string }>)[0]?.text).toContain(
      "bad argument #1 to 'drawPixel'",
    );
  });

  it("describe_capabilities responde sin error aunque Aseprite no esté conectado", async () => {
    const { bridge } = fakeBridge(() => "no debería llamarse", false);
    const client = await connectClient(bridge);

    const result = await client.callTool({ name: "describe_capabilities", arguments: {} });

    expect(result.isError).toBeFalsy();
    const payload = JSON.parse((result.content as Array<{ text: string }>)[0]!.text) as {
      connectorAlive: boolean;
    };
    expect(payload.connectorAlive).toBe(false);
  });

  it("export_spritesheet rechaza un filePath con traversal", async () => {
    const { bridge, sent } = fakeBridge();
    const client = await connectClient(bridge);

    const result = await client.callTool({
      name: "export_spritesheet",
      arguments: { filePath: "../../etc/passwd" },
    });

    expect(result.isError).toBe(true);
    expect(sent).toHaveLength(0);
  });
});
