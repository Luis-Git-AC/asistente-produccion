import { randomUUID } from "node:crypto";
import cors from "cors";
import express, {
  type Express,
  type NextFunction,
  type Request,
  type Response,
} from "express";
import type { ResponseCache } from "./cache/response-cache.js";
import type { AnthropicPort, EffortLevel } from "./llm/anthropic-port.js";
import type { AsepriteMcpPort } from "./mcp/client.js";
import { createGenerateRouter } from "./routes/generate.js";
import { createMetricsRouter } from "./routes/metrics.js";
import type { MetricsRepository } from "./telemetry/types.js";
import type { ModelId } from "@asistente/shared";

export interface AppDeps {
  port: AnthropicPort;
  mcp: AsepriteMcpPort;
  metrics: MetricsRepository;
  cache?: ResponseCache;
  corsOrigins?: string[];
  effort?: EffortLevel;
  chain?: readonly ModelId[];
  now?: () => number;
  onLog?: (message: string, context: Record<string, unknown>) => void;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

/** Logging estructurado a stderr, con `requestId` en cada línea. */
export function createLogger(): (message: string, context: Record<string, unknown>) => void {
  return (message, context) => {
    process.stderr.write(`${JSON.stringify({ message, ...context, at: new Date().toISOString() })}\n`);
  };
}

export function createApp(deps: AppDeps): Express {
  const app = express();
  const log = deps.onLog ?? createLogger();

  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin: deps.corsOrigins ?? ["http://localhost:5173"],
      methods: ["GET", "POST", "OPTIONS"],
    }),
  );

  // Identificador por petición: cose los logs, la telemetría y el evento `done`.
  app.use((req: Request, res: Response, next: NextFunction) => {
    const requestId = randomUUID();
    req.requestId = requestId;
    res.setHeader("X-Request-Id", requestId);
    next();
  });

  app.get("/api/health", (_req: Request, res: Response) => {
    res.json({ status: "ok" });
  });

  app.use("/api", createGenerateRouter({ ...deps, onLog: log }));
  app.use("/api", createMetricsRouter({ metrics: deps.metrics, ...(deps.now ? { now: deps.now } : {}) }));

  app.use((req: Request, res: Response) => {
    res.status(404).json({ code: "not_found", message: `Ruta no encontrada: ${req.path}` });
  });

  /**
   * Middleware de errores.
   *
   * **Nunca** devuelve el mensaje del error ni el stack al cliente: un error del SDK puede llevar
   * la URL de la petición, cabeceras o fragmentos de la credencial. Al cliente le va un código y
   * su `requestId`; el detalle completo se queda en el log del servidor.
   */
  app.use((error: unknown, req: Request, res: Response, _next: NextFunction) => {
    const requestId = req.requestId ?? "desconocido";
    log("error no controlado", {
      requestId,
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });

    if (res.headersSent) {
      res.end();
      return;
    }
    res.status(500).json({
      code: "internal_error",
      message: "Error interno del servidor.",
      requestId,
    });
  });

  return app;
}
