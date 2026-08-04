import type { ReactNode } from "react";
import styles from "./primitives.module.css";

/**
 * Primitivas de gráfico en SVG inline. Sin librerías: los cuatro gráficos del panel son
 * geometría simple, y una dependencia de charting costaría más de lo que ahorra.
 *
 * Reglas heredadas del método de dataviz:
 *  - Marcas finas, rejilla y ejes recesivos: manda el dato, no el andamiaje.
 *  - Los slots categóricos se asignan en orden FIJO, nunca cíclico. El orden es el mecanismo
 *    de seguridad para daltonismo (validado: peor par adyacente ΔE 8.4), no una decisión estética.
 *  - El texto usa tinta de texto, nunca el color de la serie; el color lo lleva la marca.
 *  - En modo claro, aqua y amarillo quedan por debajo de 3:1 sobre blanco, así que TODA serie
 *    lleva etiqueta directa o entrada de leyenda con su valor: el color nunca va solo.
 */

/** Slots categóricos, en orden fijo. Se asignan por posición, jamás por rango del dato. */
export const SERIES_VARS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
] as const;

export function seriesColor(index: number): string {
  // Nunca se genera un color nuevo: si se agotan los slots, el dato debe plegarse en "Otros".
  return SERIES_VARS[index % SERIES_VARS.length] ?? SERIES_VARS[0];
}

export function formatUsd(value: number): string {
  if (value === 0) return "$0";
  if (value < 0.01) return `$${value.toFixed(4)}`;
  if (value < 1) return `$${value.toFixed(3)}`;
  return `$${value.toFixed(2)}`;
}

export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(1)}s`;
  return `${String(Math.round(ms))}ms`;
}

export function formatTokens(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(Math.round(value));
}

export function formatPercent(fraction: number, digits = 0): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

export function formatDay(ms: number): string {
  return new Date(ms).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

export function formatTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Escala lineal de dominio a rango de píxeles. */
export function scale(value: number, domainMax: number, rangePx: number): number {
  if (domainMax <= 0) return 0;
  return (value / domainMax) * rangePx;
}

/** Redondea el máximo hacia arriba a un valor "bonito", para que los ticks salgan legibles. */
export function niceMax(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const normalized = value / magnitude;
  const step = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
}

interface LegendItem {
  label: string;
  color: string;
  /** Valor mostrado junto a la etiqueta: es el relieve cuando el contraste no basta. */
  value?: string;
}

/** Leyenda. Obligatoria a partir de dos series: la identidad nunca depende sólo del color. */
export function Legend({ items }: { items: LegendItem[] }) {
  if (items.length < 2) return null;
  return (
    <ul className={styles.legend}>
      {items.map((item) => (
        <li key={item.label} className={styles.legendItem}>
          <span className={styles.swatch} style={{ background: item.color }} aria-hidden="true" />
          <span className={styles.legendLabel}>{item.label}</span>
          {item.value !== undefined && <span className={styles.legendValue}>{item.value}</span>}
        </li>
      ))}
    </ul>
  );
}

/**
 * Ancho del sistema de coordenadas interno. El SVG escala de forma UNIFORME
 * (`preserveAspectRatio` por defecto): con `none` el texto de los ejes saldría estirado en
 * horizontal, que es el fallo clásico de un gráfico SVG hecho a mano.
 */
export const CHART_WIDTH = 600;

/**
 * Estado vacío de un gráfico. Es un componente aparte y no un flag de `ChartFrame` para que
 * el marco no pueda existir sin marcas dentro: un SVG en blanco parece un fallo de render.
 */
export function ChartEmpty({ label = "Sin datos en esta ventana." }: { label?: string }) {
  return <p className={styles.empty}>{label}</p>;
}

interface ChartFrameProps {
  /** Descripción para lectores de pantalla: el SVG no se lee solo. */
  description: string;
  height: number;
  children: ReactNode;
  legend?: LegendItem[];
}

export function ChartFrame({ description, height, children, legend }: ChartFrameProps) {
  return (
    <div className={styles.frame}>
      <svg
        className={styles.svg}
        viewBox={`0 0 ${String(CHART_WIDTH)} ${String(height)}`}
        role="img"
        aria-label={description}
      >
        {children}
      </svg>
      {legend !== undefined && <Legend items={legend} />}
    </div>
  );
}

/** Rejilla horizontal recesiva con sus etiquetas de valor. */
export function GridLines({
  ticks,
  height,
  format,
}: {
  ticks: number[];
  height: number;
  format: (value: number) => string;
}) {
  const max = ticks[ticks.length - 1] ?? 1;
  return (
    <g>
      {ticks.map((tick) => {
        const y = height - scale(tick, max, height);
        // El tick más alto cae en y=0: su etiqueta encima quedaría fuera del viewBox. Cuando
        // no hay sitio arriba, se escribe debajo de la línea.
        const labelY = y < 14 ? y + 12 : y - 4;
        return (
          <g key={tick}>
            <line x1={0} x2={CHART_WIDTH} y1={y} y2={y} className={styles.grid} />
            <text x={2} y={labelY} className={styles.tickLabel}>
              {format(tick)}
            </text>
          </g>
        );
      })}
    </g>
  );
}

export { styles as chartStyles };
