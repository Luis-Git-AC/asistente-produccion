import { afterEach, describe, expect, it } from "vitest";
import {
  buildAlerts,
  buildCostSeries,
  buildDashboard,
  buildFallbackSeries,
  buildStageLatency,
  buildTokenSeries,
} from "./dashboard.js";
import { SqliteMetricsRepository } from "./sqlite-repository.js";
import type { RequestMetrics } from "./types.js";

const NOW = 1_700_000_000_000;
const HOUR = 3_600_000;
const DAY = 86_400_000;

const repos: SqliteMetricsRepository[] = [];

function makeRepo(): SqliteMetricsRepository {
  const repo = new SqliteMetricsRepository();
  repos.push(repo);
  return repo;
}

afterEach(() => {
  while (repos.length > 0) repos.pop()?.close();
});

function row(overrides: Partial<RequestMetrics> = {}): RequestMetrics {
  return {
    requestId: `r-${Math.random().toString(36).slice(2)}`,
    promptHash: "a".repeat(64),
    promptPreview: "un icono de gema",
    model: "claude-opus-5",
    attempts: 1,
    fellBack: false,
    cache: "miss",
    inputTokens: 40,
    outputTokens: 5000,
    cacheReadTokens: 0,
    cacheCreationTokens: 3239,
    costUsd: 0.13,
    llmMs: 60_000,
    validateMs: 1,
    renderMs: 20,
    totalMs: 60_021,
    status: "ok",
    errorCode: null,
    filePath: "output/a.aseprite",
    spritesheetPath: "output/a.png",
    createdAt: NOW,
    ...overrides,
  };
}

describe("buildCostSeries", () => {
  it("reparte el coste en intervalos y acumula", () => {
    const since = NOW - 4 * HOUR;
    const rows = [
      row({ createdAt: since + 100, costUsd: 1 }),
      row({ createdAt: since + 2 * HOUR, costUsd: 2 }),
      row({ createdAt: since + 3.5 * HOUR, costUsd: 3 }),
    ];

    const series = buildCostSeries(rows, since, NOW, 4);

    expect(series).toHaveLength(4);
    expect(series.at(-1)?.cumulativeUsd).toBeCloseTo(6, 10);
    // El acumulado nunca baja.
    for (let i = 1; i < series.length; i += 1) {
      expect(series[i]!.cumulativeUsd).toBeGreaterThanOrEqual(series[i - 1]!.cumulativeUsd);
    }
  });

  it("desglosa por modelo dentro de cada intervalo", () => {
    const since = NOW - HOUR;
    const rows = [
      row({ createdAt: since + 10, model: "claude-opus-5", costUsd: 1 }),
      row({ createdAt: since + 20, model: "claude-sonnet-5", costUsd: 0.5 }),
    ];

    const series = buildCostSeries(rows, since, NOW, 1);

    expect(series[0]?.costByModel).toEqual({ "claude-opus-5": 1, "claude-sonnet-5": 0.5 });
  });

  it("una ventana sin datos da intervalos a cero, no NaN", () => {
    const series = buildCostSeries([], NOW - HOUR, NOW, 3);

    expect(series).toHaveLength(3);
    expect(series.every((bucket) => bucket.cumulativeUsd === 0)).toBe(true);
    expect(series.some((bucket) => Number.isNaN(bucket.cumulativeUsd))).toBe(false);
  });
});

describe("buildStageLatency", () => {
  it("reparte el share entre etapas y suma 1", () => {
    const stages = buildStageLatency([row(), row()]);

    const total = stages.reduce((sum, stage) => sum + stage.share, 0);
    expect(total).toBeCloseTo(1, 6);
  });

  it("refleja el dominio real del LLM sobre el render", () => {
    // 60s de LLM contra 20ms de render: el share del LLM debe ser ~100 %.
    const llm = stageOf(buildStageLatency([row()]), "llm");
    const render = stageOf(buildStageLatency([row()]), "render");

    expect(llm.share).toBeGreaterThan(0.99);
    expect(render.share).toBeLessThan(0.01);
    // Pero la media en ms sigue siendo el dato real, no un 0 redondeado.
    expect(render.meanMs).toBe(20);
  });

  it("excluye los cache hits del promedio de LLM", () => {
    const stages = buildStageLatency([
      row({ cache: "miss", llmMs: 60_000 }),
      row({ cache: "hit", llmMs: 0 }),
    ]);

    // Incluir el 0 del hit daría 30 000 y fingiría una mejora que no existe.
    expect(stageOf(stages, "llm").meanMs).toBe(60_000);
  });

  it("no produce NaN sin datos", () => {
    const stages = buildStageLatency([]);

    expect(stages.every((stage) => Number.isFinite(stage.meanMs) && Number.isFinite(stage.share))).toBe(
      true,
    );
  });
});

function stageOf(
  stages: ReturnType<typeof buildStageLatency>,
  stage: "llm" | "validate" | "render",
): ReturnType<typeof buildStageLatency>[number] {
  const found = stages.find((entry) => entry.stage === stage);
  if (found === undefined) throw new Error(`etapa ${stage} ausente`);
  return found;
}

describe("buildTokenSeries", () => {
  it("devuelve las últimas N peticiones", () => {
    const rows = Array.from({ length: 40 }, (_, i) => row({ createdAt: NOW + i }));

    expect(buildTokenSeries(rows, 10)).toHaveLength(10);
  });

  it("conserva el desglose que hace visible el prompt caching", () => {
    const [point] = buildTokenSeries([row({ cacheReadTokens: 3239, cacheCreationTokens: 0 })]);

    expect(point).toMatchObject({ inputTokens: 40, outputTokens: 5000, cacheReadTokens: 3239 });
  });
});

describe("buildFallbackSeries", () => {
  it("agrupa por día y calcula la tasa", () => {
    const series = buildFallbackSeries([
      row({ createdAt: NOW, fellBack: true, attempts: 4 }),
      row({ createdAt: NOW + 1000, fellBack: false }),
      row({ createdAt: NOW + DAY, fellBack: false }),
    ]);

    expect(series).toHaveLength(2);
    expect(series[0]?.rate).toBe(0.5);
    expect(series[0]?.meanAttempts).toBe(2.5);
    expect(series[1]?.rate).toBe(0);
  });

  it("sale ordenado cronológicamente", () => {
    const series = buildFallbackSeries([
      row({ createdAt: NOW + 2 * DAY }),
      row({ createdAt: NOW }),
    ]);

    expect(series[0]!.dayMs).toBeLessThan(series[1]!.dayMs);
  });
});

describe("buildAlerts", () => {
  it("sin datos no inventa alertas", () => {
    expect(buildAlerts([])).toEqual([]);
  });

  it("avisa cuando un prompt repetido nunca lee de caché", () => {
    // El invalidador silencioso: el caching deja de funcionar sin dar ningún error.
    const alerts = buildAlerts([
      row({ promptHash: "b".repeat(64), cache: "miss", cacheReadTokens: 0 }),
      row({ promptHash: "b".repeat(64), cache: "miss", cacheReadTokens: 0 }),
    ]);

    expect(alerts.map((a) => a.id)).toContain("cache-prefix-invalidated");
    expect(alerts.find((a) => a.id === "cache-prefix-invalidated")?.action).toMatch(/prompts/u);
  });

  it("NO avisa si el prompt repetido sí lee de caché", () => {
    const alerts = buildAlerts([
      row({ promptHash: "c".repeat(64), cacheReadTokens: 0 }),
      row({ promptHash: "c".repeat(64), cacheReadTokens: 3239 }),
    ]);

    expect(alerts.map((a) => a.id)).not.toContain("cache-prefix-invalidated");
  });

  it("avisa si la tasa de fallback supera el 10 %", () => {
    const rows = [
      row({ fellBack: true }),
      ...Array.from({ length: 4 }, () => row({ fellBack: false })),
    ];

    expect(buildAlerts(rows).map((a) => a.id)).toContain("fallback-rate-high");
  });

  it("escala a crítica si el fallback pasa del 30 %", () => {
    const rows = [row({ fellBack: true }), row({ fellBack: false })];

    expect(buildAlerts(rows).find((a) => a.id === "fallback-rate-high")?.level).toBe("critical");
  });

  it("avisa si el coste medio por sprite supera el umbral configurable", () => {
    const alerts = buildAlerts([row({ costUsd: 0.9 })], { costPerSpriteThresholdUsd: 0.25 });

    expect(alerts.map((a) => a.id)).toContain("cost-per-sprite-high");
  });

  it("los cache hits no bajan artificialmente el coste medio de la alerta", () => {
    // Un hit cuesta 0; promediarlo escondería que las peticiones reales son caras.
    const alerts = buildAlerts(
      [row({ costUsd: 0.9 }), row({ cache: "hit", costUsd: 0 })],
      { costPerSpriteThresholdUsd: 0.25 },
    );

    expect(alerts.map((a) => a.id)).toContain("cost-per-sprite-high");
  });

  it("toda alerta trae una acción concreta", () => {
    const alerts = buildAlerts([row({ fellBack: true }), row({ costUsd: 9 })]);

    expect(alerts.length).toBeGreaterThan(0);
    for (const alert of alerts) expect(alert.action.length).toBeGreaterThan(10);
  });
});

describe("buildDashboard", () => {
  it("compara contra la ventana anterior", () => {
    const repo = makeRepo();
    repo.record(row({ requestId: "viejo", createdAt: NOW - 30 * HOUR, costUsd: 1 }));
    repo.record(row({ requestId: "nuevo", createdAt: NOW - HOUR, costUsd: 2 }));

    const payload = buildDashboard(repo, { windowMs: 24 * HOUR, now: NOW });

    expect(payload.requests).toBe(1);
    expect(payload.previous?.requests).toBe(1);
    expect(payload.previous?.totalCostUsd).toBeCloseTo(1, 10);
  });

  it("previous es null cuando no hay ventana anterior con datos", () => {
    const repo = makeRepo();
    repo.record(row({ createdAt: NOW - HOUR }));

    expect(buildDashboard(repo, { windowMs: 24 * HOUR, now: NOW }).previous).toBeNull();
  });

  it("la tabla reciente trae la URL servible del spritesheet", () => {
    const repo = makeRepo();
    repo.record(row({ createdAt: NOW - HOUR, spritesheetPath: "output/gem-icon.png" }));

    const [first] = buildDashboard(repo, { windowMs: 24 * HOUR, now: NOW }).recent;

    expect(first?.spritesheetUrl).toBe("/api/assets/gem-icon.png");
  });

  it("una petición fallida no inventa URL", () => {
    const repo = makeRepo();
    repo.record(row({ createdAt: NOW - HOUR, status: "error", spritesheetPath: null }));

    expect(buildDashboard(repo, { windowMs: 24 * HOUR, now: NOW }).recent[0]?.spritesheetUrl).toBeNull();
  });

  it("la tabla sale de más reciente a más antigua", () => {
    const repo = makeRepo();
    repo.record(row({ requestId: "a", createdAt: NOW - 3 * HOUR }));
    repo.record(row({ requestId: "b", createdAt: NOW - HOUR }));

    expect(buildDashboard(repo, { windowMs: 24 * HOUR, now: NOW }).recent[0]?.requestId).toBe("b");
  });

  it("una ventana vacía devuelve una estructura completa sin NaN", () => {
    const payload = buildDashboard(makeRepo(), { windowMs: HOUR, now: NOW });

    expect(payload.requests).toBe(0);
    expect(payload.costSeries.length).toBeGreaterThan(0);
    expect(payload.stageLatency).toHaveLength(3);
    expect(payload.alerts).toEqual([]);
    expect(payload.recent).toEqual([]);
    expect(Number.isNaN(payload.averageCostUsd)).toBe(false);
  });
});
