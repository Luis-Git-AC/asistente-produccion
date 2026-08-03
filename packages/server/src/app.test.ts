import type { Server } from "node:http";
import { request as httpRequest } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";
import { SqliteMetricsRepository } from "./telemetry/sqlite-repository.js";
import { fakePort, specResponse, TEST_CHAIN } from "./llm/test-support.js";
import { fakeMcp, type FakeMcp } from "./routes/test-support.js";
import type { AnthropicPort, SpecMessageRequest, SpecMessageResponse } from "./llm/anthropic-port.js";
import type { MetricsRepository } from "./telemetry/types.js";

const repos: SqliteMetricsRepository[] = [];
const servers: Server[] = [];

function makeApp(
  options: { port?: AnthropicPort; mcp?: FakeMcp; metrics?: MetricsRepository } = {},
): { app: ReturnType<typeof createApp>; mcp: FakeMcp } {
  let metrics = options.metrics;
  if (metrics === undefined) {
    const sqlite = new SqliteMetricsRepository();
    repos.push(sqlite);
    metrics = sqlite;
  }
  const mcp = options.mcp ?? fakeMcp();
  const app = createApp({
    port: options.port ?? fakePort([specResponse()]),
    mcp,
    metrics,
    chain: TEST_CHAIN,
    onLog: () => {},
  });
  return { app, mcp };
}

async function listen(server: Server): Promise<number> {
  servers.push(server);
  await new Promise<void>((resolve) => {
    if (server.listening) {
      resolve();
      return;
    }
    server.once("listening", () => {
      resolve();
    });
  });
  return (server.address() as AddressInfo).port;
}

afterEach(async () => {
  while (repos.length > 0) repos.pop()?.close();
  while (servers.length > 0) {
    const server = servers.pop();
    await new Promise<void>((resolve) => {
      server?.close(() => {
        resolve();
      });
    });
  }
  vi.restoreAllMocks();
});

describe("createApp", () => {
  it("expone un health check", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/api/health");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ status: "ok" });
  });

  it("devuelve un requestId en la cabecera de cada respuesta", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/api/health");

    expect(response.headers["x-request-id"]).toMatch(/^[0-9a-f-]{36}$/u);
  });

  it("responde 404 tipado ante una ruta desconocida", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/api/no-existe");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("not_found");
  });

  it("permite CORS desde el dev server de Vite", async () => {
    const { app } = makeApp();
    const response = await request(app).get("/api/health").set("Origin", "http://localhost:5173");

    expect(response.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
  });
});

describe("middleware de errores", () => {
  it("no filtra el mensaje interno, la credencial ni el stack", async () => {
    // Repositorio que revienta con un error que arrastra algo parecido a una credencial:
    // es exactamente la forma en que un error del SDK podría filtrar la API key.
    const explodingMetrics: MetricsRepository = {
      record: () => {},
      aggregate: () => {
        throw new Error("fallo con x-api-key: sk-ant-secreta-de-verdad en la cabecera");
      },
      recent: () => [],
      close: () => {},
    };
    const { app } = makeApp({ metrics: explodingMetrics });

    const response = await request(app).get("/api/metrics");

    expect(response.status).toBe(500);
    expect(response.body.code).toBe("internal_error");

    const body = JSON.stringify(response.body);
    expect(body).not.toContain("sk-ant");
    expect(body).not.toContain("x-api-key");
    expect(body).not.toContain("at Object");
    expect(response.body).not.toHaveProperty("stack");
    // Pero sí el requestId, para poder cruzarlo con el log del servidor.
    expect(response.body.requestId).toMatch(/^[0-9a-f-]{36}$/u);
  });
});

describe("abort del cliente a mitad de stream", () => {
  it("cancela el trabajo y no lanza el render en el MCP", async () => {
    let llmStarted!: () => void;
    const llmHasStarted = new Promise<void>((resolve) => {
      llmStarted = resolve;
    });

    // El LLM se queda colgado hasta que lo aborten: reproduce a un usuario que cierra la
    // pestaña mientras el modelo genera.
    const hangingPort: AnthropicPort = {
      createSpecMessage: (req: SpecMessageRequest): Promise<SpecMessageResponse> => {
        llmStarted();
        return new Promise<SpecMessageResponse>((_resolve, reject) => {
          req.signal?.addEventListener("abort", () => {
            reject(Object.assign(new Error("abortado"), { name: "AbortError" }));
          });
        });
      },
    };

    const { app, mcp } = makeApp({ port: hangingPort });
    const port = await listen(app.listen(0));

    const clientReq = httpRequest({
      host: "127.0.0.1",
      port,
      path: "/api/generate",
      method: "POST",
      headers: { "content-type": "application/json" },
    });
    clientReq.on("error", () => {
      /* esperado: el abort lo provocamos nosotros */
    });
    clientReq.write(JSON.stringify({ prompt: "un icono de gema 8x8" }));
    clientReq.end();

    await llmHasStarted;

    // El cliente cuelga a mitad del streaming.
    clientReq.destroy();
    await new Promise((resolve) => setTimeout(resolve, 300));

    // Lo que importa: el render nunca se lanzó, así que no queda un proceso MCP huérfano
    // materializando un sprite que ya no va a recoger nadie.
    expect(mcp.calls).toHaveLength(0);
    expect(mcp.generateSprite).not.toHaveBeenCalled();
  });

  it("el trabajo sí llega al MCP cuando el cliente NO aborta", async () => {
    // Contraprueba: si el test anterior pasara por otra razón (p.ej. el MCP nunca se llama),
    // este fallaría. Aísla que lo medido es el abort y no un mock inerte.
    const { app, mcp } = makeApp();
    const port = await listen(app.listen(0));

    const body = await new Promise<string>((resolve, reject) => {
      const req = httpRequest(
        {
          host: "127.0.0.1",
          port,
          path: "/api/generate",
          method: "POST",
          headers: { "content-type": "application/json" },
        },
        (res) => {
          let chunks = "";
          res.on("data", (chunk) => (chunks += String(chunk)));
          res.on("end", () => {
            resolve(chunks);
          });
        },
      );
      req.on("error", reject);
      req.write(JSON.stringify({ prompt: "un icono de gema 8x8" }));
      req.end();
    });

    expect(body).toContain("event: done");
    expect(mcp.generateSprite).toHaveBeenCalledTimes(1);
  });
});
