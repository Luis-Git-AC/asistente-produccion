import type { TokenPoint } from "@asistente/shared";
import {
  CHART_WIDTH,
  ChartEmpty,
  ChartFrame,
  GridLines,
  chartStyles,
  formatTokens,
  niceMax,
  scale,
  seriesColor,
} from "./primitives.js";

const HEIGHT = 190;
/** Hueco de 2px entre barras contiguas: sin él, la serie se lee como un bloque continuo. */
const BAR_GAP = 2;

const LAYERS = [
  { key: "cacheReadTokens", label: "caché leída" },
  { key: "cacheCreationTokens", label: "caché escrita" },
  { key: "inputTokens", label: "entrada" },
  { key: "outputTokens", label: "salida" },
] as const satisfies ReadonlyArray<{ key: keyof TokenPoint; label: string }>;

/**
 * Tokens por petición.
 *
 * Forma: columnas apiladas, una por petición, en orden cronológico. El objetivo no es la
 * tendencia sino la COMPOSICIÓN: cuando el prompt caching entra, la capa de "entrada" se
 * desploma y aparece la de "caché leída". Ese cambio de composición es la prueba visual de
 * que la caché funciona, y una línea de totales lo escondería por completo.
 */
export function TokensChart({ points }: { points: TokenPoint[] }) {
  if (points.length === 0) {
    return <ChartEmpty label="Ninguna petición con tokens en esta ventana." />;
  }

  const totals = points.map((point) =>
    LAYERS.reduce((sum, layer) => sum + point[layer.key], 0),
  );
  const max = niceMax(Math.max(...totals, 1));

  const slot = CHART_WIDTH / points.length;
  const barWidth = Math.max(1, slot - BAR_GAP);

  const layerTotals = LAYERS.map((layer) =>
    points.reduce((sum, point) => sum + point[layer.key], 0),
  );

  return (
    <ChartFrame
      description={`Tokens de las últimas ${String(points.length)} peticiones, por tipo`}
      height={HEIGHT}
      legend={LAYERS.map((layer, index) => ({
        label: layer.label,
        color: seriesColor(index),
        value: formatTokens(layerTotals[index] ?? 0),
      }))}
    >
      <GridLines ticks={[max / 2, max]} height={HEIGHT} format={formatTokens} />
      {points.map((point, i) => {
        const x = i * slot;
        let stacked = 0;
        return (
          <g key={point.requestId}>
            {LAYERS.map((layer, index) => {
              const value = point[layer.key];
              if (value <= 0) return null;
              const barHeight = scale(value, max, HEIGHT);
              const y = HEIGHT - scale(stacked + value, max, HEIGHT);
              stacked += value;
              return (
                <rect
                  key={layer.key}
                  x={x}
                  y={y}
                  width={barWidth}
                  height={Math.max(0.5, barHeight)}
                  fill={seriesColor(index)}
                />
              );
            })}
          </g>
        );
      })}
      <line x1={0} x2={CHART_WIDTH} y1={HEIGHT} y2={HEIGHT} className={chartStyles.axis} />
    </ChartFrame>
  );
}
