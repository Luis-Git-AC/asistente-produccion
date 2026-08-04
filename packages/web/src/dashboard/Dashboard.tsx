import { Panel } from "../components/Panel/Panel.js";
import { Alerts } from "./Alerts.js";
import styles from "./Dashboard.module.css";
import { KpiRow } from "./KpiRow.js";
import { RecentTable } from "./RecentTable.js";
import { WindowPicker } from "./WindowPicker.js";
import { CostChart } from "./charts/CostChart.js";
import { FallbackChart } from "./charts/FallbackChart.js";
import { StageChart } from "./charts/StageChart.js";
import { TokensChart } from "./charts/TokensChart.js";
import { formatMs, formatPercent, formatTokens } from "./charts/primitives.js";
import { useDashboard } from "./useDashboard.js";

/**
 * Panel de coste, tokens y latencia.
 *
 * Los filtros van en UNA fila sobre los gráficos, y la ventana seleccionada se refleja en la
 * URL: el panel se comparte por enlace y quien lo abre ve exactamente lo mismo.
 */
export function Dashboard() {
  const { status, data, error, window: selected, setWindow, reload } = useDashboard();

  if (status === "loading" && data === null) {
    return <p className={styles.state}>Cargando telemetría…</p>;
  }

  if (status === "error" && data === null) {
    return (
      <div className={styles.state}>
        <p>No se pudo cargar la telemetría: {error}</p>
        <button type="button" className={styles.retry} onClick={reload}>
          Reintentar
        </button>
      </div>
    );
  }

  if (data === null) return null;

  const models = data.byModel.map((entry) => entry.model);

  return (
    <div className={styles.dashboard}>
      <div className={styles.controls}>
        <WindowPicker value={selected} onChange={setWindow} />
        <span className={styles.meta}>
          {new Date(data.since).toLocaleString()} → ahora
          {status === "error" && <span className={styles.stale}> · datos sin refrescar</span>}
        </span>
        <button type="button" className={styles.retry} onClick={reload}>
          Refrescar
        </button>
      </div>

      <KpiRow data={data} />

      <Alerts alerts={data.alerts} />

      <div className={styles.grid}>
        <Panel
          title="Coste acumulado por modelo"
          aside={`${String(data.requests)} peticiones`}
        >
          <CostChart series={data.costSeries} models={models} />
        </Panel>

        <Panel title="Dónde se va el tiempo" aside={`p95 ${formatMs(data.totalLatency.p95)}`}>
          <StageChart stages={data.stageLatency} />
        </Panel>

        <Panel
          title="Tokens por petición"
          aside={`caché ${formatPercent(data.cacheHitRate)} · ${formatTokens(
            data.totalCacheReadTokens,
          )} leídos`}
        >
          <TokensChart points={data.tokenSeries} />
        </Panel>

        <Panel title="Fallback por día" aside={formatPercent(data.fallbackRate, 1)}>
          <FallbackChart points={data.fallbackSeries} />
        </Panel>

        <div className={styles.fullWidth}>
          <Panel title="Peticiones recientes" flush aside={`${String(data.recent.length)} filas`}>
            <RecentTable rows={data.recent} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
