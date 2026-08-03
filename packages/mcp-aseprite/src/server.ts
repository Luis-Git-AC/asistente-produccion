import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { SPRITESHEET_LAYOUTS, SpriteSpecSchema } from "@asistente/shared";
import { z } from "zod";
import { AsepriteBridge, DEFAULT_ASEPRITE_WS_PORT } from "./bridge/ws-server.js";
import {
  describeCapabilities,
  describeToolError,
  exportSpritesheet,
  generateSprite,
  type ToolContext,
} from "./tools.js";
import { DEFAULT_OUTPUT_DIR } from "./output-paths.js";

/**
 * MCP server (transporte stdio) que materializa un `SpriteSpec` en Aseprite.
 *
 * IMPORTANTE: en stdio, **stdout es el canal del protocolo MCP**. Cualquier `console.log` lo
 * corrompe. Todo el logging va por stderr.
 */

const SERVER_NAME = "asistente-mcp-aseprite";
const SERVER_VERSION = "0.1.0";

function log(message: string): void {
  process.stderr.write(`[${SERVER_NAME}] ${message}\n`);
}

/** Envuelve un resultado como `tool_result` de texto con JSON legible. */
function ok(payload: unknown): { content: [{ type: "text"; text: string }] } {
  return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
}

function fail(error: unknown): {
  content: [{ type: "text"; text: string }];
  isError: true;
} {
  return { content: [{ type: "text", text: describeToolError(error) }], isError: true };
}

export function createMcpServer(context: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    "generate_sprite",
    {
      title: "Generar sprite en Aseprite",
      description:
        "Materializa un SpriteSpec validado en un documento .aseprite real y exporta su " +
        "spritesheet. Emite un único script Lua en una sola transacción.",
      // El input_schema se deriva del Zod de @asistente/shared: una sola definición del contrato.
      inputSchema: { spec: SpriteSpecSchema },
    },
    async ({ spec }) => {
      try {
        return ok(await generateSprite(context, spec));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "export_spritesheet",
    {
      title: "Exportar spritesheet",
      description:
        "Reexporta el spritesheet de un .aseprite ya generado, con grid uniforme listo para " +
        "importar en Unity (Grid By Cell Size).",
      inputSchema: {
        filePath: z
          .string()
          .describe("Ruta del .aseprite dentro del directorio de salida permitido."),
        layout: z.enum(SPRITESHEET_LAYOUTS).optional(),
        padding: z.number().optional(),
        generateJson: z.boolean().optional(),
      },
    },
    async (input) => {
      try {
        return ok(await exportSpritesheet(context, input));
      } catch (error) {
        return fail(error);
      }
    },
  );

  server.registerTool(
    "describe_capabilities",
    {
      title: "Diagnóstico del puente con Aseprite",
      description:
        "Versión de Aseprite, si el connector está vivo y los límites conocidos del puente. " +
        "Úsalo antes de generar para dar un error accionable si Aseprite no está listo.",
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await describeCapabilities(context));
      } catch (error) {
        return fail(error);
      }
    },
  );

  return server;
}

/** Arranca el puente y conecta el servidor MCP por stdio. Lo invoca `src/main.ts`. */
export async function main(): Promise<void> {
  const port = Number(process.env["ASEPRITE_WS_PORT"] ?? DEFAULT_ASEPRITE_WS_PORT);
  const outputDir = process.env["ASEPRITE_OUTPUT_DIR"] ?? DEFAULT_OUTPUT_DIR;

  const bridge = new AsepriteBridge({ port, onLog: log });
  await bridge.start();
  log(`puente WebSocket escuchando en ws://127.0.0.1:${String(port)}`);

  const server = createMcpServer({ bridge, outputDir });
  await server.connect(new StdioServerTransport());
  log("servidor MCP conectado por stdio");

  const shutdown = (): void => {
    void bridge.stop().finally(() => {
      process.exit(0);
    });
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

export { log };
