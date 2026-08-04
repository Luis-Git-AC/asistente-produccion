import type { FallbackPoint } from "@asistente/shared";
import styles from "./FallbackChart.module.css";
import {
  CHART_WIDTH,
  ChartEmpty,
  ChartFrame,
  GridLines,
  chartStyles,
  formatDay,
  formatPercent,
  niceMax,
  scale,
  seriesColor,
} from "./primitives.js";

const HEIGHT = 160;
/** Espacio reservado bajo el eje para las etiquetas de día. */
const AXIS_BAND = 18;

/**
 * Tasa de fallback por día.
 *
 * Forma: línea (cambio en el tiempo de una sola serie). Una sola serie no lleva leyenda: el
 * título la nombra.
 *
 * Los reintentos NO se pintan como segunda línea: son un recuento (intentos/petición), no una
 * fracción, y meterlos en el mismo dibujo obligaría a un segundo eje y — el error de gráfico
 * más caro que existe. Van escritos como cifras bajo el gráfico, en su propia unidad.
 */
export function FallbackChart({ points }: { points: FallbackPoint[] }) {
  if (points.length === 0) {
    return <ChartEmpty label="Sin días con peticiones en esta ventana." />;
  }

  const maxRate = Math.max(...points.map((point) => point.rate));
  // Suelo del 10 %: con todo a cero, un eje autoescalado exageraría el ruido hasta parecer alarma.
  const max = niceMax(Math.max(maxRate, 0.1));
  const plotHeight = HEIGHT - AXIS_BAND;
  const stepX = points.length > 1 ? CHART_WIDTH / (points.length - 1) : 0;

  const coords = points.map((point, i) => ({
    point,
    x: points.length > 1 ? i * stepX : CHART_WIDTH / 2,
    y: plotHeight - scale(point.rate, max, plotHeight),
  }));

  const peakIndex = points.reduce(
    (best, point, i) => (point.rate > (points[best]?.rate ?? 0) ? i : best),
    0,
  );
  // Etiquetas directas SELECTIVAS: el pico y el último día. Nunca un número en cada punto.
  const labelled = new Set([peakIndex, coords.length - 1]);

  const totalRequests = points.reduce((sum, point) => sum + point.requests, 0);
  const totalAttempts = points.reduce(
    (sum, point) => sum + point.meanAttempts * point.requests,
    0,
  );
  const attemptsPerRequest = totalRequests > 0 ? totalAttempts / totalRequests : 0;

  return (
    <div className={styles.container}>
      <ChartFrame
        description={`Tasa de fallback por día, máximo ${formatPercent(maxRate, 1)}`}
        height={HEIGHT}
      >
        <GridLines ticks={[max / 2, max]} height={plotHeight} format={(v) => formatPercent(v)} />
        <polyline
          points={coords.map((c) => `${String(c.x)},${String(c.y)}`).join(" ")}
          fill="none"
          stroke={seriesColor(1)}
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />
        {coords.map((c) => (
          <circle
            key={c.point.dayMs}
            cx={c.x}
            cy={c.y}
            r={4}
            fill={seriesColor(1)}
            // Anillo de 2px del color de la superficie: separa el marcador de la línea.
            stroke="var(--surface)"
            strokeWidth={2}
          />
        ))}
        {coords.map((c, i) =>
          labelled.has(i) ? (
            <text
              key={`label-${String(c.point.dayMs)}`}
              x={Math.min(c.x, CHART_WIDTH - 26)}
              // Un punto en el máximo del eje deja la etiqueta fuera del lienzo: se baja.
              y={Math.max(11, c.y - 10)}
              className={chartStyles.markLabel}
              textAnchor={i === 0 ? "start" : "middle"}
            >
              {formatPercent(c.point.rate, 1)}
            </text>
          ) : null,
        )}
        <line
          x1={0}
          x2={CHART_WIDTH}
          y1={plotHeight}
          y2={plotHeight}
          className={chartStyles.axis}
        />
        {coords.map((c, i) =>
          // Con muchos días se etiqueta uno de cada dos para que no colisionen.
          i % (points.length > 10 ? 2 : 1) === 0 ? (
            <text
              key={`day-${String(c.point.dayMs)}`}
              x={c.x}
              y={HEIGHT - 4}
              className={chartStyles.tickLabel}
              textAnchor={i === 0 ? "start" : i === coords.length - 1 ? "end" : "middle"}
            >
              {formatDay(c.point.dayMs)}
            </text>
          ) : null,
        )}
      </ChartFrame>

      {/* Los reintentos, en su propia unidad y fuera del eje del gráfico. */}
      <p className={styles.retries}>
        <span className={styles.retriesLabel}>Intentos por petición</span>
        <span className={styles.retriesValue}>{attemptsPerRequest.toFixed(2)}</span>
        <span className={styles.retriesHint}>
          {attemptsPerRequest <= 1.001 ? "sin reintentos en la ventana" : "1.00 = a la primera"}
        </span>
      </p>
    </div>
  );
}
