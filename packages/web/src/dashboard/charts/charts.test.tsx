import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { CostBucket, FallbackPoint, StageLatency, TokenPoint } from "@asistente/shared";
import { CostChart } from "./CostChart.js";
import { FallbackChart } from "./FallbackChart.js";
import { StageChart } from "./StageChart.js";
import { TokensChart } from "./TokensChart.js";
import { CHART_WIDTH, niceMax, scale } from "./primitives.js";

/**
 * Los gráficos se renderizan a markup estático (sin DOM) y se comprueba su GEOMETRÍA.
 *
 * Es la red que sustituye al "míralo a ojo": un gráfico SVG hecho a mano falla casi siempre de
 * las mismas tres formas — coordenadas `NaN` cuando una serie viene vacía o a cero, marcas que
 * se salen del viewBox, y etiquetas que desaparecen. Ninguna de las tres rompe el typecheck,
 * y las tres dejan un hueco en blanco en la pantalla.
 */

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 6, 1);

function costSeries(): CostBucket[] {
  let cumulative = 0;
  return Array.from({ length: 12 }, (_, i) => {
    const opus = 0.08 + i * 0.01;
    const sonnet = i % 3 === 0 ? 0.02 : 0;
    cumulative += opus + sonnet;
    return {
      startMs: T0 + i * 3_600_000,
      costByModel: { "claude-opus-5": opus, "claude-sonnet-5": sonnet },
      cumulativeUsd: cumulative,
      requests: 3,
    };
  });
}

const STAGES: StageLatency[] = [
  { stage: "llm", meanMs: 62_400, p50Ms: 58_000, p95Ms: 104_000, share: 0.9996 },
  { stage: "validate", meanMs: 3, p50Ms: 2, p95Ms: 7, share: 0.00005 },
  { stage: "render", meanMs: 24, p50Ms: 21, p95Ms: 38, share: 0.00035 },
];

function tokenPoints(count = 20): TokenPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    requestId: `req-${String(i)}`,
    createdAt: T0 + i * 60_000,
    // A partir de la tercera petición entra el prompt caching: la entrada cae y aparece lectura.
    inputTokens: i < 2 ? 3300 : 35,
    outputTokens: 900 + i * 12,
    cacheReadTokens: i < 2 ? 0 : 3239,
    cacheCreationTokens: i === 0 ? 3239 : 0,
  }));
}

const FALLBACKS: FallbackPoint[] = Array.from({ length: 7 }, (_, i) => ({
  dayMs: T0 + i * DAY,
  requests: 10 + i,
  fallbacks: i === 3 ? 2 : 0,
  rate: i === 3 ? 0.2 : 0,
  meanAttempts: i === 3 ? 1.2 : 1,
}));

/** Todos los números que aparecen en atributos geométricos del SVG. */
function numericAttributes(markup: string): number[] {
  const values: number[] = [];
  // El espacio delante es obligatorio: sin él, `text-anchor="middle"` casaría como `r="middle"`
  // y `stroke-width` como `width`, y el test se quedaría discutiendo con su propio regex.
  const attribute = /\s(?:x|y|x1|x2|y1|y2|cx|cy|r|width|height)="([^"]*)"/gu;
  for (const match of markup.matchAll(attribute)) {
    values.push(Number(match[1]));
  }
  const path = /\sd="([^"]*)"/gu;
  for (const match of markup.matchAll(path)) {
    for (const token of (match[1] ?? "").split(/[ ,MLZ]+/u)) {
      if (token !== "") values.push(Number(token));
    }
  }
  const polyline = /points="([^"]*)"/gu;
  for (const match of markup.matchAll(polyline)) {
    for (const token of (match[1] ?? "").split(/[ ,]+/u)) {
      if (token !== "") values.push(Number(token));
    }
  }
  return values;
}

/** Comprueba lo que no puede fallar nunca: nada de NaN y nada fuera de la caja. */
function expectSaneGeometry(markup: string, height: number): void {
  const values = numericAttributes(markup);
  expect(values.length).toBeGreaterThan(0);
  expect(values.filter((value) => !Number.isFinite(value))).toEqual([]);

  for (const value of values) {
    // Nada por encima del borde superior: una etiqueta en negativo se recorta y desaparece.
    expect(value).toBeGreaterThanOrEqual(0);
    expect(value).toBeLessThanOrEqual(Math.max(CHART_WIDTH, height));
  }
}

describe("CostChart", () => {
  it("apila las capas sin salirse del lienzo y suma el total en la leyenda", () => {
    const markup = renderToStaticMarkup(
      <CostChart series={costSeries()} models={["claude-opus-5", "claude-sonnet-5"]} />,
    );

    expectSaneGeometry(markup, 190);
    expect(markup).toContain("opus-5");
    expect(markup).toContain("sonnet-5");
    // La leyenda lleva el valor de cada serie: es el relieve cuando el color no basta.
    expect(markup).toMatch(/\$\d/u);
  });

  it("da a cada modelo el mismo color aunque cambie su orden en el payload", () => {
    // El servidor ordena `byModel` por volumen: en una ventana manda opus, en otra sonnet.
    const ascending = renderToStaticMarkup(
      <CostChart series={costSeries()} models={["claude-opus-5", "claude-sonnet-5"]} />,
    );
    const swapped = renderToStaticMarkup(
      <CostChart series={costSeries()} models={["claude-sonnet-5", "claude-opus-5"]} />,
    );

    // Mismo dibujo exacto: el color sigue al modelo, no a su puesto en la lista.
    expect(swapped).toBe(ascending);
    expect(ascending).toContain("var(--series-1)");
    expect(ascending).toContain("var(--series-2)");
  });

  it("no dibuja nada cuando toda la ventana está a cero", () => {
    const empty: CostBucket[] = [
      { startMs: T0, costByModel: {}, cumulativeUsd: 0, requests: 0 },
    ];
    const markup = renderToStaticMarkup(<CostChart series={empty} models={[]} />);

    expect(markup).not.toContain("<svg");
    expect(markup).toContain("Sin coste");
  });

  it("sobrevive a un único punto sin generar coordenadas inválidas", () => {
    const single: CostBucket[] = [
      {
        startMs: T0,
        costByModel: { "claude-opus-5": 0.04 },
        cumulativeUsd: 0.04,
        requests: 1,
      },
    ];
    const markup = renderToStaticMarkup(
      <CostChart series={single} models={["claude-opus-5"]} />,
    );

    expectSaneGeometry(markup, 190);
  });
});

describe("StageChart", () => {
  it("escribe la cifra de cada etapa aunque su segmento sea invisible", () => {
    const markup = renderToStaticMarkup(<StageChart stages={STAGES} />);

    // El render se lleva el 0.035 % del tiempo: su barra no se ve, su número sí.
    expect(markup).toContain("24ms");
    expect(markup).toContain("62.4s");
    expect(markup).toContain("modelo");
    expect(markup).toContain("render");
    // Percentiles presentes: la media sola escondería la cola.
    expect(markup).toContain("p95");
  });

  it("da a cada segmento un ancho visible por pequeño que sea", () => {
    const markup = renderToStaticMarkup(<StageChart stages={STAGES} />);
    const widths = [...markup.matchAll(/width:\s*([\d.]+)%/gu)].map((m) => Number(m[1]));

    expect(widths).toHaveLength(3);
    for (const width of widths) expect(width).toBeGreaterThanOrEqual(0.6);
  });

  it("conserva el color de cada etapa aunque otra desaparezca del filtro", () => {
    const conValidate = renderToStaticMarkup(<StageChart stages={STAGES} />);
    // Una ventana de puros cache hits deja `validate` a 0 y la saca del gráfico.
    const sinValidate = renderToStaticMarkup(
      <StageChart
        stages={STAGES.map((stage) =>
          stage.stage === "validate" ? { ...stage, meanMs: 0 } : stage,
        )}
      />,
    );

    // `render` mantiene su slot: sin esto pasaría al color de la etapa que se ha ido.
    expect(conValidate).toContain("var(--series-3)");
    expect(sinValidate).toContain("var(--series-3)");
    expect(sinValidate).not.toContain("var(--series-2)");
  });

  it("informa en vez de dibujar cuando no hay tiempos", () => {
    const markup = renderToStaticMarkup(
      <StageChart
        stages={[{ stage: "llm", meanMs: 0, p50Ms: 0, p95Ms: 0, share: 0 }]}
      />,
    );
    expect(markup).toContain("Sin datos de latencia");
  });
});

describe("TokensChart", () => {
  it("deja hueco entre columnas y mantiene las barras dentro del lienzo", () => {
    const markup = renderToStaticMarkup(<TokensChart points={tokenPoints()} />);

    expectSaneGeometry(markup, 190);

    const rects = [...markup.matchAll(/<rect[^>]*x="([\d.]+)"[^>]*width="([\d.]+)"/gu)];
    expect(rects.length).toBeGreaterThan(0);
    for (const rect of rects) {
      const x = Number(rect[1]);
      const width = Number(rect[2]);
      expect(x + width).toBeLessThanOrEqual(CHART_WIDTH);
      // Hueco de 2px: el ancho de barra nunca ocupa el slot entero.
      expect(width).toBeLessThan(CHART_WIDTH / 20);
    }
  });

  it("muestra en la leyenda las cuatro clases de token", () => {
    const markup = renderToStaticMarkup(<TokensChart points={tokenPoints()} />);

    expect(markup).toContain("entrada");
    expect(markup).toContain("salida");
    expect(markup).toContain("caché leída");
    expect(markup).toContain("caché escrita");
  });

  it("omite el rectángulo de una capa a cero en vez de dibujar altura cero", () => {
    const single: TokenPoint[] = [
      {
        requestId: "solo",
        createdAt: T0,
        inputTokens: 100,
        outputTokens: 200,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
      },
    ];
    const markup = renderToStaticMarkup(<TokensChart points={single} />);

    expect([...markup.matchAll(/<rect/gu)]).toHaveLength(2);
    expectSaneGeometry(markup, 190);
  });
});

describe("FallbackChart", () => {
  it("etiqueta el pico y el último día, y sólo esos", () => {
    const markup = renderToStaticMarkup(<FallbackChart points={FALLBACKS} />);

    expectSaneGeometry(markup, 160);
    // Pico del día 4 (20 %) y último día (0 %). Nunca un número en cada punto.
    expect(markup).toContain("20.0%");
    const labels = [...markup.matchAll(/markLabel[^>]*>([^<]+)</gu)];
    expect(labels).toHaveLength(2);
  });

  it("no infla el eje cuando no hubo ningún fallback", () => {
    const calm = FALLBACKS.map((point) => ({
      ...point,
      fallbacks: 0,
      rate: 0,
      meanAttempts: 1,
    }));
    const markup = renderToStaticMarkup(<FallbackChart points={calm} />);

    expectSaneGeometry(markup, 160);
    // Suelo del 10 % en el eje: sin él, cero ruido se dibujaría como una montaña.
    expect(markup).toContain("10%");
    expect(markup).toContain("sin reintentos");
  });

  it("centra el punto cuando sólo hay un día", () => {
    const markup = renderToStaticMarkup(<FallbackChart points={[FALLBACKS[0]!]} />);

    expectSaneGeometry(markup, 160);
    expect(markup).toContain(`cx="${String(CHART_WIDTH / 2)}"`);
  });
});

describe("primitivas de escala", () => {
  it("devuelve 0 en vez de NaN cuando el dominio es 0", () => {
    expect(scale(0, 0, 100)).toBe(0);
    expect(scale(5, 0, 100)).toBe(0);
  });

  it("redondea el máximo a un valor legible", () => {
    expect(niceMax(0.37)).toBeCloseTo(0.5, 10);
    expect(niceMax(9.345)).toBe(10);
    expect(niceMax(0)).toBe(1);
  });
});
