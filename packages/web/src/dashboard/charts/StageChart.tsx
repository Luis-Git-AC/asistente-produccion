import type { StageLatency } from "@asistente/shared";
import { STAGE_ORDER, stageColor } from "../seriesMapping.js";
import styles from "./StageChart.module.css";
import { formatMs, formatPercent } from "./primitives.js";

const STAGE_LABEL: Record<StageLatency["stage"], string> = {
  llm: "modelo",
  validate: "validación",
  render: "render",
};

/**
 * Dónde se va el tiempo.
 *
 * Forma: barra apilada horizontal (parte del todo). Con el LLM en decenas de segundos y el
 * render en milisegundos, el segmento de render es literalmente invisible — y ese desequilibrio
 * ES el hallazgo, no un defecto del gráfico. Por eso cada etapa lleva SIEMPRE su cifra escrita:
 * la barra comunica la proporción, el número comunica la magnitud. Una escala logarítmica
 * "arreglaría" el dibujo a costa de ocultar justo lo que hay que ver.
 */
export function StageChart({ stages }: { stages: StageLatency[] }) {
  // Se descartan las etapas sin tiempo y se fija el orden del pipeline: el color de cada etapa
  // no puede depender de cuáles hayan sobrevivido al filtro.
  const withTime = stages
    .filter((stage) => stage.meanMs > 0)
    .sort((a, b) => STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage));

  if (withTime.length === 0) {
    return <p className={styles.empty}>Sin datos de latencia en esta ventana.</p>;
  }

  const totalMean = withTime.reduce((sum, stage) => sum + stage.meanMs, 0);

  return (
    <div className={styles.container}>
      <div className={styles.bar} role="img" aria-label={`Reparto del tiempo: ${withTime
        .map((s) => `${STAGE_LABEL[s.stage]} ${formatMs(s.meanMs)}`)
        .join(", ")}`}
      >
        {withTime.map((stage) => (
          <span
            key={stage.stage}
            className={styles.segment}
            style={{
              // Suelo del 0.6 % para que un segmento diminuto siga siendo visible como marca.
              width: `${String(Math.max(0.6, (stage.meanMs / totalMean) * 100))}%`,
              background: stageColor(stage.stage),
            }}
          />
        ))}
      </div>

      {/* Etiquetas directas: son el relieve obligatorio cuando el segmento no se puede ver. */}
      <ul className={styles.rows}>
        {withTime.map((stage) => (
          <li key={stage.stage} className={styles.row}>
            <span
              className={styles.swatch}
              style={{ background: stageColor(stage.stage) }}
              aria-hidden="true"
            />
            <span className={styles.name}>{STAGE_LABEL[stage.stage]}</span>
            <span className={styles.share}>{formatPercent(stage.share, 1)}</span>
            <span className={styles.mean}>{formatMs(stage.meanMs)}</span>
            <span className={styles.percentiles}>
              p50 {formatMs(stage.p50Ms)} · p95 {formatMs(stage.p95Ms)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
