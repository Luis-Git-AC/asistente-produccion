import type { DashboardPayload } from "@asistente/shared";
import styles from "./KpiRow.module.css";
import { formatMs, formatPercent, formatUsd } from "./charts/primitives.js";

/**
 * Cinco cifras de cabecera.
 *
 * Forma: NO son gráficos. Cada una es un solo número y su cambio contra la ventana anterior;
 * un sparkline aquí sería adorno — el detalle temporal ya está en los gráficos de abajo.
 */

/** Sentido de un cambio: para el coste y la latencia, bajar es bueno. */
type Direction = "lower-is-better" | "higher-is-better";

interface Kpi {
  label: string;
  value: string;
  hint: string;
  previous: number | undefined;
  current: number;
  direction: Direction;
  /** Formatea el delta en la unidad del KPI cuando el relativo no dice nada (p. ej. tasas). */
  formatDelta?: (delta: number) => string;
}

function Delta({ kpi }: { kpi: Kpi }) {
  if (kpi.previous === undefined) {
    return <span className={styles.deltaMuted}>sin ventana previa</span>;
  }

  const diff = kpi.current - kpi.previous;
  // Umbral muerto: por debajo del 0.5 % es ruido, y pintarlo de color miente.
  const relative = kpi.previous === 0 ? (diff === 0 ? 0 : 1) : diff / kpi.previous;
  if (Math.abs(relative) < 0.005) {
    return <span className={styles.deltaMuted}>sin cambio</span>;
  }

  const good = kpi.direction === "lower-is-better" ? diff < 0 : diff > 0;
  const text =
    kpi.formatDelta?.(diff) ??
    (kpi.previous === 0 ? "nuevo" : formatPercent(Math.abs(relative), 0));

  return (
    <span className={good ? styles.deltaGood : styles.deltaBad}>
      {/* Flecha + signo: el sentido no se transmite sólo por color. */}
      <span aria-hidden="true">{diff > 0 ? "▲" : "▼"}</span> {text}
      <span className={styles.srOnly}>{good ? " (mejora)" : " (empeora)"}</span>
    </span>
  );
}

export function KpiRow({ data }: { data: DashboardPayload }) {
  const previous = data.previous;

  const kpis: Kpi[] = [
    {
      label: "Peticiones",
      value: String(data.requests),
      hint: data.errors > 0 ? `${String(data.errors)} con error` : "sin errores",
      current: data.requests,
      previous: previous?.requests,
      direction: "higher-is-better",
    },
    {
      label: "Coste total",
      value: formatUsd(data.totalCostUsd),
      hint: `${formatUsd(data.averageCostUsd)} por sprite`,
      current: data.totalCostUsd,
      previous: previous?.totalCostUsd,
      direction: "lower-is-better",
    },
    {
      label: "Coste por sprite",
      value: formatUsd(data.averageCostUsd),
      hint: "media de la ventana",
      current: data.averageCostUsd,
      previous: previous?.averageCostUsd,
      direction: "lower-is-better",
    },
    {
      label: "Aciertos de caché",
      value: formatPercent(data.cacheHitRate),
      hint: `${String(data.cacheHits)} de ${String(data.requests)}`,
      current: data.cacheHitRate,
      previous: previous?.cacheHitRate,
      direction: "higher-is-better",
      // Una tasa se compara en puntos, no en porcentaje de porcentaje.
      formatDelta: (diff) => `${Math.abs(diff * 100).toFixed(1)} pts`,
    },
    {
      label: "Latencia p95",
      value: formatMs(data.totalLatency.p95),
      hint: `p50 ${formatMs(data.totalLatency.p50)}`,
      current: data.totalLatency.p95,
      previous: previous?.totalLatencyP95,
      direction: "lower-is-better",
    },
  ];

  return (
    <ul className={styles.row}>
      {kpis.map((kpi) => (
        <li key={kpi.label} className={styles.tile}>
          <span className={styles.label}>{kpi.label}</span>
          <span className={styles.value}>{kpi.value}</span>
          <span className={styles.footer}>
            <Delta kpi={kpi} />
            <span className={styles.hint}>{kpi.hint}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}
