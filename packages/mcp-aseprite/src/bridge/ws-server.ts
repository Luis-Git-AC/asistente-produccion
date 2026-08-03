import { randomUUID } from "node:crypto";
import { WebSocketServer, type WebSocket } from "ws";

/**
 * Servidor WebSocket que habla con la extensión `aseprite/extension/asistente-connector`.
 *
 * El sentido de la conexión es contraintuitivo: **Aseprite es el cliente** (su API Lua sólo trae
 * cliente WebSocket), así que Node levanta el servidor y espera a que el connector se conecte.
 * De ahí que "reconexión" aquí signifique aceptar que el connector vuelva tras un reinicio de
 * Aseprite, no reintentar una conexión saliente.
 */

export const DEFAULT_ASEPRITE_WS_PORT = 3001;
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

/**
 * Sobre que viaja hacia el connector.
 *
 * Se serializa como `"<id>\n<lua>"`, NO como JSON: el módulo `json` de Aseprite varía entre
 * builds y cuando falla lo hace en silencio dentro del callback, produciendo el síntoma más caro
 * de este puente (un socket conectado que nunca responde). Partir por la primera línea no puede
 * fallar a medias. La respuesta sí viene en JSON, porque quien la parsea es Node.
 */
export interface LuaRequestEnvelope {
  id: string;
  lua: string;
}

/** Serializa el sobre al formato de línea que entiende `connector.lua`. */
export function encodeRequestEnvelope(envelope: LuaRequestEnvelope): string {
  return `${envelope.id}\n${envelope.lua}`;
}

/** Contraparte de `encodeRequestEnvelope`, usada por los dobles de test. */
export function decodeRequestEnvelope(raw: string): LuaRequestEnvelope | undefined {
  const newlineIndex = raw.indexOf("\n");
  if (newlineIndex <= 0) return undefined;
  return { id: raw.slice(0, newlineIndex), lua: raw.slice(newlineIndex + 1) };
}

/** Sobre que devuelve el connector. */
export interface LuaResponseEnvelope {
  id: string;
  ok: boolean;
  result?: string;
  error?: string;
}

export class AsepriteBridgeError extends Error {
  readonly code: "not_connected" | "timeout" | "lua_error" | "closed";

  constructor(code: AsepriteBridgeError["code"], message: string) {
    super(message);
    this.name = "AsepriteBridgeError";
    this.code = code;
  }
}

interface PendingRequest {
  resolve: (result: string) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export interface AsepriteBridgeOptions {
  port?: number;
  timeoutMs?: number;
  /** Inyectable para los tests; por defecto genera un UUID v4. */
  idFactory?: () => string;
  onLog?: (message: string) => void;
}

export class AsepriteBridge {
  readonly #port: number;
  readonly #timeoutMs: number;
  readonly #idFactory: () => string;
  readonly #onLog: (message: string) => void;
  readonly #pending = new Map<string, PendingRequest>();

  #server: WebSocketServer | undefined;
  #socket: WebSocket | undefined;

  constructor(options: AsepriteBridgeOptions = {}) {
    this.#port = options.port ?? DEFAULT_ASEPRITE_WS_PORT;
    this.#timeoutMs = options.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
    this.#idFactory = options.idFactory ?? ((): string => randomUUID());
    this.#onLog = options.onLog ?? ((): void => {});
  }

  get port(): number {
    return this.#port;
  }

  /** `true` cuando el connector de Aseprite está conectado y listo para recibir Lua. */
  get isConnected(): boolean {
    return this.#socket !== undefined && this.#socket.readyState === 1;
  }

  async start(): Promise<void> {
    if (this.#server !== undefined) return;

    await new Promise<void>((resolve, reject) => {
      const server = new WebSocketServer({ host: "127.0.0.1", port: this.#port });
      const onError = (error: Error): void => {
        server.off("listening", onListening);
        reject(error);
      };
      const onListening = (): void => {
        server.off("error", onError);
        resolve();
      };
      server.once("error", onError);
      server.once("listening", onListening);

      server.on("connection", (socket) => {
        // Un único connector a la vez. Si ya había uno, se cierra explícitamente en vez de
        // limitarse a soltar la referencia: un connector zombi conectado al mismo puerto compite
        // por las respuestas y produce diagnósticos imposibles de interpretar.
        const previous = this.#socket;
        if (previous !== undefined && previous !== socket) {
          this.#onLog("llegó un connector nuevo; cerrando el anterior");
          previous.close();
        }

        this.#socket = socket;
        this.#onLog(`connector conectado en el puerto ${String(this.#port)}`);

        socket.on("message", (raw) => {
          this.#handleMessage(raw.toString());
        });
        socket.on("close", () => {
          if (this.#socket === socket) this.#socket = undefined;
          this.#onLog("connector desconectado");
        });
        socket.on("error", (error) => {
          this.#onLog(`error de socket: ${error.message}`);
        });
      });

      this.#server = server;
    });
  }

  #handleMessage(raw: string): void {
    let envelope: LuaResponseEnvelope;
    try {
      envelope = JSON.parse(raw) as LuaResponseEnvelope;
    } catch {
      this.#onLog(`respuesta ignorada, no es JSON: ${raw.slice(0, 120)}`);
      return;
    }

    const pending = this.#pending.get(envelope.id);
    if (pending === undefined) {
      this.#onLog(`respuesta sin petición asociada: ${envelope.id}`);
      return;
    }

    this.#pending.delete(envelope.id);
    clearTimeout(pending.timer);

    if (envelope.ok) {
      pending.resolve(envelope.result ?? "OK");
    } else {
      // El mensaje real de Aseprite, no un genérico: es lo único que hace diagnosticable
      // un fallo de Lua desde el otro lado del socket.
      pending.reject(
        new AsepriteBridgeError("lua_error", envelope.error ?? "error de Lua sin mensaje"),
      );
    }
  }

  /**
   * Envía un script Lua y espera su resultado, correlacionado por `id`.
   * Una tarea = un script = una llamada a `sendLua`.
   */
  async sendLua(lua: string): Promise<string> {
    const socket = this.#socket;
    if (socket === undefined || socket.readyState !== 1) {
      throw new AsepriteBridgeError(
        "not_connected",
        `El connector de Aseprite no está conectado en ws://127.0.0.1:${String(this.#port)}. ` +
          "Abre Aseprite y usa File > Asistente: Connect (ver aseprite/README.md).",
      );
    }

    const id = this.#idFactory();
    const envelope: LuaRequestEnvelope = { id, lua };

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#pending.delete(id);
        reject(
          new AsepriteBridgeError(
            "timeout",
            `Aseprite no respondió en ${String(this.#timeoutMs)} ms. ` +
              "Comprueba que ningún diálogo modal esté bloqueando su interfaz.",
          ),
        );
      }, this.#timeoutMs);

      this.#pending.set(id, { resolve, reject, timer });
      socket.send(encodeRequestEnvelope(envelope), (error) => {
        if (error !== undefined && error !== null) {
          this.#pending.delete(id);
          clearTimeout(timer);
          reject(new AsepriteBridgeError("not_connected", error.message));
        }
      });
    });
  }

  async stop(): Promise<void> {
    for (const [id, pending] of this.#pending) {
      clearTimeout(pending.timer);
      pending.reject(new AsepriteBridgeError("closed", "El puente se cerró antes de responder."));
      this.#pending.delete(id);
    }

    this.#socket?.close();
    this.#socket = undefined;

    const server = this.#server;
    this.#server = undefined;
    if (server === undefined) return;

    await new Promise<void>((resolve) => {
      server.close(() => {
        resolve();
      });
    });
  }
}
