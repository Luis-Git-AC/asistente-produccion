import { mkdirSync } from "node:fs";
import { SPRITESHEET_LAYOUTS, type SpriteSpec } from "@asistente/shared";
import { AsepriteBridgeError, type AsepriteBridge } from "./bridge/ws-server.js";
import {
  collectWarnings,
  emitDescribeCapabilitiesLua,
  emitExportSpritesheetLua,
  emitGenerateSpriteLua,
} from "./lua/emit.js";
import {
  DEFAULT_OUTPUT_DIR,
  resolveExistingOutputPath,
  resolveOutputPaths,
  UnsafeOutputPathError,
} from "./output-paths.js";

/**
 * Lógica de las tools, separada del transporte MCP para poder probarla sin levantar un servidor.
 * Este paquete EJECUTA; no razona: nunca llama a la API de Anthropic.
 */

export interface ToolContext {
  bridge: AsepriteBridge;
  outputDir?: string;
}

export interface GenerateSpriteResult {
  filePath: string;
  spritesheetPath: string;
  jsonPath: string;
  frameCount: number;
  warnings: string[];
  /** Resumen que devolvió Aseprite, útil para verificar sin volcar píxeles. */
  asepriteStatus: string;
}

export async function generateSprite(
  context: ToolContext,
  spec: SpriteSpec,
): Promise<GenerateSpriteResult> {
  const outputDir = context.outputDir ?? DEFAULT_OUTPUT_DIR;
  const paths = resolveOutputPaths(spec.name, outputDir);

  // Aseprite no crea directorios: si `output/` no existe, `saveAs` y `ExportSpriteSheet`
  // fallan desde dentro de Lua con un error mucho menos claro que este mkdir.
  mkdirSync(paths.outputDir, { recursive: true });

  const lua = emitGenerateSpriteLua(spec, {
    asepritePath: paths.asepritePath,
    spritesheetPath: paths.spritesheetPath,
    jsonPath: paths.jsonPath,
  });

  // Una tarea = un script = un mensaje por el socket.
  const asepriteStatus = await context.bridge.sendLua(lua);

  return {
    filePath: paths.asepritePath,
    spritesheetPath: paths.spritesheetPath,
    jsonPath: paths.jsonPath,
    frameCount: spec.frames.length,
    warnings: collectWarnings(spec),
    asepriteStatus,
  };
}

export interface ExportSpritesheetInput {
  filePath: string;
  // `| undefined` explícito: Zod entrega las claves opcionales presentes con valor undefined,
  // y con `exactOptionalPropertyTypes` eso no encaja en un `?:` a secas.
  layout?: (typeof SPRITESHEET_LAYOUTS)[number] | undefined;
  padding?: number | undefined;
  generateJson?: boolean | undefined;
}

export interface ExportSpritesheetResult {
  spritesheetPath: string;
  jsonPath: string | null;
  asepriteStatus: string;
}

export async function exportSpritesheet(
  context: ToolContext,
  input: ExportSpritesheetInput,
): Promise<ExportSpritesheetResult> {
  const outputDir = context.outputDir ?? DEFAULT_OUTPUT_DIR;
  const asepritePath = resolveExistingOutputPath(input.filePath, outputDir);
  const generateJson = input.generateJson ?? true;

  const base = asepritePath.replace(/\.aseprite$/iu, "");
  const spritesheetPath = `${base}.png`;
  const jsonPath = `${base}.json`;

  const lua = emitExportSpritesheetLua({
    asepritePath,
    spritesheetPath,
    jsonPath,
    layout: input.layout ?? "rows",
    padding: input.padding ?? 0,
    generateJson,
  });

  const asepriteStatus = await context.bridge.sendLua(lua);

  return {
    spritesheetPath,
    jsonPath: generateJson ? jsonPath : null,
    asepriteStatus,
  };
}

export interface CapabilitiesResult {
  connectorAlive: boolean;
  asepriteVersion: string | null;
  wsPort: number;
  outputDir: string;
  /** Límites conocidos, para que el llamante no tenga que descubrirlos por ensayo y error. */
  knownLimits: string[];
  detail?: string;
}

export async function describeCapabilities(context: ToolContext): Promise<CapabilitiesResult> {
  const outputDir = context.outputDir ?? DEFAULT_OUTPUT_DIR;
  const knownLimits = [
    "Requiere Aseprite v1.3+ (API WebSocket y modulo json).",
    "El connector no se reconecta solo: si Aseprite se reinicia hay que relanzar el script.",
    "Un diálogo modal abierto en Aseprite bloquea el socket hasta que se cierre.",
    "Las salidas se confinan al directorio de salida; los nombres se sanean con path.basename.",
    "frame.duration se envía en segundos; el SpriteSpec lo declara en milisegundos.",
  ];

  if (!context.bridge.isConnected) {
    return {
      connectorAlive: false,
      asepriteVersion: null,
      wsPort: context.bridge.port,
      outputDir,
      knownLimits,
      detail:
        "El connector no está conectado. Abre Aseprite y ejecuta aseprite/connector.lua " +
        "(ver aseprite/README.md).",
    };
  }

  try {
    const summary = await context.bridge.sendLua(emitDescribeCapabilitiesLua());
    const version = /version=([^|]+)/u.exec(summary)?.[1]?.trim() ?? null;
    return {
      connectorAlive: true,
      asepriteVersion: version,
      wsPort: context.bridge.port,
      outputDir,
      knownLimits,
      detail: summary,
    };
  } catch (error) {
    return {
      connectorAlive: false,
      asepriteVersion: null,
      wsPort: context.bridge.port,
      outputDir,
      knownLimits,
      detail: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Traduce un fallo a un mensaje útil para el `tool_result`. Un error de Lua vuelve con el
 * mensaje REAL de Aseprite, no con un genérico: es lo único que lo hace diagnosticable.
 */
export function describeToolError(error: unknown): string {
  if (error instanceof AsepriteBridgeError) {
    switch (error.code) {
      case "lua_error":
        return `Aseprite rechazó el script: ${error.message}`;
      case "not_connected":
      case "timeout":
      case "closed":
        return error.message;
    }
  }
  if (error instanceof UnsafeOutputPathError) {
    return `Ruta de salida no permitida: ${error.message}`;
  }
  return error instanceof Error ? error.message : String(error);
}
