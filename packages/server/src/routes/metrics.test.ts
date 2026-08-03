import { afterEach, describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "../app.js";
import { SqliteMetricsRepository } from "../telemetry/sqlite-repository.js";
import { fakePort, specResponse, TEST_CHAIN } from "../llm/test-support.js";
import { fakeMcp } from "./test-support.js";
import { parseWindowMs } from "./sse.js";
import type { RequestMetrics } from "../telemetry/types.js";

const repos: SqliteMetricsRepository[] = [];
const NOW = 1_700_000_000_000;

function makeApp(): { app: ReturnType<typeof createApp>; metrics: SqliteMetricsRepository } {
  const metrics = new SqliteMetricsRepository();
  repos.push(metrics);
  const app = createApp({
    port: fakePort([specResponse()]),
    mcp: fakeMcp(),
    metrics,
    chain: TEST_CHAIN,
    now: () => NOW + 1000,
    onLog: () => {},
  });
  return { app, metrics };
}

function fixture(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    requestId: `r-${Math.random().toString(36).slice(2)}`,
    promptHash: "b".repeat(64),
    promptPreview: "prompt",
    model: "claude-opus-5",
    attempts: 1,
    fellBack: false,
    cache: "miss",
    inputTokens: 100,
    outputTokens: 200,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0.01,
    llmMs: 500,
    validateMs: 1,
    renderMs: 100,
    totalMs: 601,
    status: "ok",
    errorCode: null,
    filePath: null,
    spritesheetPath: null,
    createdAt: NOW,
    ...overrides,
  };
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.close();
});

describe("parseWindowMs", () => {
  it.each([
    ["30m", 1_800_000],
    ["1h", 3_600_000],
    ["24h", 86_400_000],
    ["7d", 604_800_000],
    ["30d", 2_592_000_000],
  ])("interpreta %s", (input, expected) => {
    expect(parseWindowMs(input, 0)).toBe(expected);
  });

  it("cae al valor por defecto ante basura o ausencia", () => {
    expect(parseWindowMs(undefined, 999)).toBe(999);
    expect(parseWindowMs("", 999)).toBe(999);
    expect(parseWindowMs("mañana", 999)).toBe(999);
    expect(parseWindowMs("24x", 999)).toBe(999);
  });
});

describe("GET /api/metrics", () => {
  it("responde 200 con la forma esperada aunque no haya datos", async () => {
    const { app } = makeApp();

    const response = await request(app).get("/api/metrics");

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      requests: 0,
      totalCostUsd: 0,
      cacheHitRate: 0,
      llmLatency: { p50: 0, p95: 0 },
      renderLatency: { p50: 0, p95: 0 },
      byModel: [],
      recent: [],
    });
  });

  it("calcula p50/p95 correctamente sobre un dataset conocido", async () => {
    const { app, metrics } = makeApp();
    for (let i = 1; i <= 10; i += 1) {
      metrics.record(fixture({ requestId: `r${String(i)}`, llmMs: i * 100, renderMs: i * 10 }));
    }

    const response = await request(app).get("/api/metrics?window=1h");

    expect(response.status).toBe(200);
    expect(response.body.requests).toBe(10);
    expect(response.body.llmLatency.p50).toBeCloseTo(550, 6);
    expect(response.body.llmLatency.p95).toBeCloseTo(955, 6);
    expect(response.body.renderLatency.p50).toBeCloseTo(55, 6);
    expect(response.body.renderLatency.p95).toBeCloseTo(95.5, 6);
  });

  it("aplica la ventana pedida", async () => {
    const { app, metrics } = makeApp();
    metrics.record(fixture({ requestId: "viejo", createdAt: NOW - 7_200_000 }));
    metrics.record(fixture({ requestId: "nuevo", createdAt: NOW }));

    const oneHour = await request(app).get("/api/metrics?window=1h");
    const oneDay = await request(app).get("/api/metrics?window=24h");

    expect(oneHour.body.requests).toBe(1);
    expect(oneDay.body.requests).toBe(2);
  });

  it("expone el desglose por modelo y la cache hit rate", async () => {
    const { app, metrics } = makeApp();
    metrics.record(fixture({ requestId: "a", model: "claude-opus-5", cache: "miss" }));
    metrics.record(fixture({ requestId: "b", model: "claude-sonnet-5", cache: "hit", costUsd: 0 }));

    const response = await request(app).get("/api/metrics?window=1h");

    expect(response.body.cacheHitRate).toBe(0.5);
    expect(response.body.byModel).toHaveLength(2);
  });

  it("acota el límite de peticiones recientes", async () => {
    const { app, metrics } = makeApp();
    for (let i = 0; i < 12; i += 1) {
      metrics.record(fixture({ requestId: `r${String(i)}`, createdAt: NOW + i }));
    }

    const response = await request(app).get("/api/metrics?limit=5");

    expect(response.body.recent).toHaveLength(5);
  });

  it("ignora un limit absurdo y usa el valor por defecto", async () => {
    const { app, metrics } = makeApp();
    metrics.record(fixture());

    const response = await request(app).get("/api/metrics?limit=-3");

    expect(response.status).toBe(200);
    expect(response.body.recent).toHaveLength(1);
  });
});
