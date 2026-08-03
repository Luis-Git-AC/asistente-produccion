import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { SpriteSpec } from "@asistente/shared";

/**
 * Cliente MCP hacia `@asistente/mcp-aseprite`, lanzado por stdio.
 *
 * Ciclo de vida gestionado: arranque perezoso (no se lanza el proceso hijo hasta la primera
 * petición que lo necesita), cierre limpio y health check. El orquestador nunca habla con
 * Aseprite: habla con este cliente, que habla con el MCP, que habla con Aseprite.
 */

export interface McpToolError {
  isError: true;
  message: string;
}

export class McpClientError extends Error {
  readonly code: "spawn_failed" | "tool_error" | "not_started" | "invalid_response";

  constructor(code: McpClientError["code"], message: string) {
    super(message);
    this.name = "McpClientError";
    this.code = code;
  }
}

export interface GenerateSpriteToolResult {
  filePath: string;
  spritesheetPath: string;
  jsonPath: string;
  frameCount: number;
  warnings: string[];
  asepriteStatus: string;
}

export interface CapabilitiesToolResult {
  connectorAlive: boolean;
  asepriteVersion: string | null;
  wsPort: number;
  outputDir: string;
  knownLimits: string[];
  detail?: string;
}

/**
 * Resuelve cómo lanzar el MCP server.
 *
 * Se invoca a `node` con el CLI de tsx **por ruta absoluta**, en vez de `npx tsx` o el shim
 * `tsx.cmd`: en Windows, lanzar un `.cmd` desde `StdioClientTransport` deja el proceso colgado
 * sin que llegue nunca el `initialize`. Con `process.execPath` no hay shim de por medio.
 */
export function defaultMcpLaunchConfig(): { command: string; args: string[]; cwd: string } {
  const here = dirname(fileURLToPath(import.meta.url));
  const packageRoot = resolve(here, "..", "..");
  const mcpPackageRoot = resolve(packageRoot, "..", "mcp-aseprite");

  const require = createRequire(import.meta.url);
  const tsxCli = require.resolve("tsx/cli");

  return {
    command: process.execPath,
    args: [tsxCli, resolve(mcpPackageRoot, "src", "main.ts")],
    cwd: resolve(packageRoot, "..", ".."),
  };
}

export interface AsepriteMcpClientOptions {
  command?: string;
  args?: string[];
  cwd?: string;
  env?: Record<string, string>;
  onLog?: (message: string) => void;
}

/** Interfaz mínima que consume el orquestador, para poder mockearla en los tests. */
export interface AsepriteMcpPort {
  generateSprite(spec: SpriteSpec): Promise<GenerateSpriteToolResult>;
  describeCapabilities(): Promise<CapabilitiesToolResult>;
  close(): Promise<void>;
}

/** Extrae el texto del `tool_result` y lo parsea, distinguiendo error de éxito. */
function readToolResult<T>(result: unknown): T {
  const typed = result as {
    isError?: boolean;
    content?: Array<{ type: string; text?: string }>;
  };
  const text = typed.content?.find((block) => block.type === "text")?.text ?? "";

  if (typed.isError === true) {
    // El mensaje real que devolvió el MCP (y con él, el de Aseprite), no un genérico.
    throw new McpClientError("tool_error", text || "el MCP devolvió un error sin mensaje");
  }

  try {
    return JSON.parse(text) as T;
  } catch {
    throw new McpClientError(
      "invalid_response",
      `El MCP devolvió algo que no es JSON: ${text.slice(0, 200)}`,
    );
  }
}

export class AsepriteMcpClient implements AsepriteMcpPort {
  readonly #options: AsepriteMcpClientOptions;
  readonly #onLog: (message: string) => void;
  #client: Client | undefined;
  #starting: Promise<Client> | undefined;

  constructor(options: AsepriteMcpClientOptions = {}) {
    this.#options = options;
    this.#onLog = options.onLog ?? ((): void => {});
  }

  get isStarted(): boolean {
    return this.#client !== undefined;
  }

  /** Arranque perezoso e idempotente: varias peticiones concurrentes comparten un solo proceso. */
  async #ensureStarted(): Promise<Client> {
    if (this.#client !== undefined) return this.#client;
    this.#starting ??= this.#start();
    try {
      return await this.#starting;
    } catch (error) {
      this.#starting = undefined;
      throw error;
    }
  }

  async #start(): Promise<Client> {
    const defaults = defaultMcpLaunchConfig();
    const command = this.#options.command ?? defaults.command;
    const args = this.#options.args ?? defaults.args;
    const cwd = this.#options.cwd ?? defaults.cwd;

    this.#onLog(`lanzando MCP: ${command} ${args.join(" ")}`);

    try {
      const transport = new StdioClientTransport({
        command,
        args,
        cwd,
        // Sólo se propagan las variables que el hijo necesita: la API key no pinta nada aquí.
        env: {
          PATH: process.env["PATH"] ?? "",
          ...(this.#options.env ?? {}),
        },
        stderr: "pipe",
      });

      const client = new Client({ name: "asistente-server", version: "0.1.0" });
      await client.connect(transport);

      this.#client = client;
      this.#onLog("MCP conectado");
      return client;
    } catch (error) {
      throw new McpClientError(
        "spawn_failed",
        `No se pudo lanzar el MCP server: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  async generateSprite(spec: SpriteSpec): Promise<GenerateSpriteToolResult> {
    const client = await this.#ensureStarted();
    const result = await client.callTool({ name: "generate_sprite", arguments: { spec } });
    return readToolResult<GenerateSpriteToolResult>(result);
  }

  async describeCapabilities(): Promise<CapabilitiesToolResult> {
    const client = await this.#ensureStarted();
    const result = await client.callTool({ name: "describe_capabilities", arguments: {} });
    return readToolResult<CapabilitiesToolResult>(result);
  }

  /** Health check: lista las tools disponibles sin ejecutar ninguna. */
  async listToolNames(): Promise<string[]> {
    const client = await this.#ensureStarted();
    const { tools } = await client.listTools();
    return tools.map((tool) => tool.name);
  }

  async close(): Promise<void> {
    const client = this.#client;
    this.#client = undefined;
    this.#starting = undefined;
    if (client === undefined) return;

    try {
      await client.close();
      this.#onLog("MCP cerrado");
    } catch (error) {
      this.#onLog(`error al cerrar el MCP: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
