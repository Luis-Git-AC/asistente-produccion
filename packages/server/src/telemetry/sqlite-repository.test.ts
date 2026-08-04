import { afterEach, describe, expect, it } from "vitest";
import { percentile, SqliteMetricsRepository } from "./sqlite-repository.js";
import type { RequestMetrics } from "./types.js";

const repos: SqliteMetricsRepository[] = [];

function makeRepo(): SqliteMetricsRepository {
  const repo = new SqliteMetricsRepository();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.close();
});

const NOW = 1_700_000_000_000;

function metricsFixture(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    requestId: `req-${Math.random().toString(36).slice(2)}`,
    promptHash: "a".repeat(64),
    promptPreview: "un icono de gema",
    model: "claude-opus-5",
    attempts: 1,
    fellBack: false,
    cache: "miss",
    inputTokens: 1000,
    outputTokens: 2000,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    costUsd: 0.055,
    llmMs: 1000,
    validateMs: 5,
    renderMs: 200,
    totalMs: 1205,
    status: "ok",
    errorCode: null,
    filePath: "/out/a.aseprite",
    spritesheetPath: "/out/a.png",
    createdAt: NOW,
    ...overrides,
  };
}

describe("percentile", () => {
  it("devuelve 0 sobre una muestra vacía", () => {
    expect(percentile([], 0.5)).toBe(0);
  });

  it("devuelve el único valor cuando sólo hay uno", () => {
    expect(percentile([42], 0.95)).toBe(42);
  });

  it("calcula la mediana de una muestra impar", () => {
    expect(percentile([1, 2, 3], 0.5)).toBe(2);
  });

  it("interpola la mediana de una muestra par", () => {
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
  });

  it("calcula p95 sobre 1..100 con interpolación lineal", () => {
    // Con rank = (100-1)*0.95 = 94.05 -> entre el valor 95 y el 96.
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 0.95)).toBeCloseTo(95.05, 10);
  });

  it("p50 y p95 coinciden si todos los valores son iguales", () => {
    const values = [7, 7, 7, 7];
    expect(percentile(values, 0.5)).toBe(7);
    expect(percentile(values, 0.95)).toBe(7);
  });
});

describe("SqliteMetricsRepository", () => {
  it("una ventana vacía devuelve agregados a cero, no NaN", () => {
    const aggregate = makeRepo().aggregate({ windowMs: 3600_000, now: NOW });

    expect(aggregate.requests).toBe(0);
    expect(aggregate.totalCostUsd).toBe(0);
    expect(aggregate.averageCostUsd).toBe(0);
    expect(aggregate.cacheHitRate).toBe(0);
    expect(aggregate.llmLatency).toEqual({ p50: 0, p95: 0 });
    expect(Number.isNaN(aggregate.averageCostUsd)).toBe(false);
  });

  it("calcula p50 y p95 de llmMs sobre un dataset conocido", () => {
    const repo = makeRepo();
    // llmMs de 100 a 1000 en saltos de 100: p50 = 550, p95 = 955.
    for (let i = 1; i <= 10; i += 1) {
      repo.record(metricsFixture({ requestId: `r${String(i)}`, llmMs: i * 100 }));
    }

    const aggregate = repo.aggregate({ windowMs: 3600_000, now: NOW + 1000 });

    expect(aggregate.requests).toBe(10);
    expect(aggregate.llmLatency.p50).toBeCloseTo(550, 10);
    expect(aggregate.llmLatency.p95).toBeCloseTo(955, 10);
  });

  it("excluye los cache hits del percentil de LLM", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "miss", cache: "miss", llmMs: 1000 }));
    repo.record(metricsFixture({ requestId: "hit", cache: "hit", llmMs: 0, costUsd: 0 }));

    const aggregate = repo.aggregate({ windowMs: 3600_000, now: NOW + 1000 });

    // Incluir el 0 del hit hundiría el p50 a 500 y fingiría una mejora que no existe.
    expect(aggregate.llmLatency.p50).toBe(1000);
    expect(aggregate.cacheHitRate).toBe(0.5);
  });

  it("suma coste y tokens y calcula la media", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "a", costUsd: 0.1, inputTokens: 100, outputTokens: 200 }));
    repo.record(metricsFixture({ requestId: "b", costUsd: 0.3, inputTokens: 300, outputTokens: 400 }));

    const aggregate = repo.aggregate({ windowMs: 3600_000, now: NOW + 1000 });

    expect(aggregate.totalCostUsd).toBeCloseTo(0.4, 10);
    expect(aggregate.averageCostUsd).toBeCloseTo(0.2, 10);
    expect(aggregate.totalInputTokens).toBe(400);
    expect(aggregate.totalOutputTokens).toBe(600);
  });

  it("desglosa por modelo, ordenado por número de peticiones", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "a", model: "claude-sonnet-5", costUsd: 0.01 }));
    repo.record(metricsFixture({ requestId: "b", model: "claude-opus-5", costUsd: 0.05 }));
    repo.record(metricsFixture({ requestId: "c", model: "claude-opus-5", costUsd: 0.05 }));

    const aggregate = repo.aggregate({ windowMs: 3600_000, now: NOW + 1000 });

    expect(aggregate.byModel[0]).toMatchObject({ model: "claude-opus-5", requests: 2 });
    expect(aggregate.byModel[1]).toMatchObject({ model: "claude-sonnet-5", requests: 1 });
    expect(aggregate.byModel[0]?.costUsd).toBeCloseTo(0.1, 10);
  });

  it("respeta la ventana temporal", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "viejo", createdAt: NOW - 7_200_000 }));
    repo.record(metricsFixture({ requestId: "reciente", createdAt: NOW - 60_000 }));

    const oneHour = repo.aggregate({ windowMs: 3_600_000, now: NOW });
    const threeHours = repo.aggregate({ windowMs: 10_800_000, now: NOW });

    expect(oneHour.requests).toBe(1);
    expect(threeHours.requests).toBe(2);
  });

  it("calcula la tasa de fallback", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "a", fellBack: true }));
    repo.record(metricsFixture({ requestId: "b", fellBack: false }));
    repo.record(metricsFixture({ requestId: "c", fellBack: false }));
    repo.record(metricsFixture({ requestId: "d", fellBack: false }));

    expect(repo.aggregate({ windowMs: 3600_000, now: NOW + 1 }).fallbackRate).toBe(0.25);
  });

  it("cuenta los errores por separado", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "ok" }));
    repo.record(metricsFixture({ requestId: "ko", status: "error", errorCode: "refusal" }));

    const aggregate = repo.aggregate({ windowMs: 3600_000, now: NOW + 1 });
    expect(aggregate.requests).toBe(2);
    expect(aggregate.errors).toBe(1);
  });

  it("recent devuelve las más nuevas primero y respeta el límite", () => {
    const repo = makeRepo();
    for (let i = 0; i < 5; i += 1) {
      repo.record(metricsFixture({ requestId: `r${String(i)}`, createdAt: NOW + i }));
    }

    const recent = repo.recent(3);

    expect(recent).toHaveLength(3);
    expect(recent[0]?.requestId).toBe("r4");
    expect(recent[2]?.requestId).toBe("r2");
  });

  it("ignora un requestId duplicado en vez de reventar", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "mismo" }));

    expect(() => {
      repo.record(metricsFixture({ requestId: "mismo" }));
    }).not.toThrow();
    expect(repo.recent(10)).toHaveLength(1);
  });

  it("conserva el desglose de latencias al leer de vuelta", () => {
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "x", llmMs: 11, validateMs: 22, renderMs: 33, totalMs: 66 }));

    const [row] = repo.recent(1);

    expect(row).toMatchObject({ llmMs: 11, validateMs: 22, renderMs: 33, totalMs: 66 });
  });
});

describe("ventana acotada por arriba", () => {
  it("no incluye filas posteriores a `now`", () => {
    // Es lo que permite pedir la ventana ANTERIOR pasando `now: since`.
    const repo = makeRepo();
    repo.record(metricsFixture({ requestId: "antes", createdAt: NOW - 1000 }));
    repo.record(metricsFixture({ requestId: "despues", createdAt: NOW + 1000 }));

    const aggregate = repo.aggregate({ windowMs: 3600_000, now: NOW });

    expect(aggregate.requests).toBe(1);
  });

  it("dos ventanas contiguas no se solapan", () => {
    const repo = makeRepo();
    const hour = 3600_000;
    repo.record(metricsFixture({ requestId: "vieja", createdAt: NOW - 90 * 60 * 1000 }));
    repo.record(metricsFixture({ requestId: "nueva", createdAt: NOW - 10 * 60 * 1000 }));

    const current = repo.aggregate({ windowMs: hour, now: NOW });
    const previous = repo.aggregate({ windowMs: hour, now: NOW - hour });

    expect(current.requests).toBe(1);
    expect(previous.requests).toBe(1);
  });
});
