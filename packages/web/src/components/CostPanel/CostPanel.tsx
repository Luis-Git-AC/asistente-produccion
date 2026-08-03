import clsx from "clsx";
import type { DonePayload } from "@asistente/shared";
import styles from "./CostPanel.module.css";

interface CostPanelProps {
  result: DonePayload | null;
}

function formatTokens(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${String(Math.round(ms))}ms`;
}

/**
 * Coste y tokens de la generación, visibles en cada petición y no escondidos en el dashboard:
 * tratar el modelo como una dependencia con precio es medio propósito del proyecto.
 */
export function CostPanel({ result }: CostPanelProps) {
  if (result === null) {
    return <p className={styles.empty}>Los tokens y el coste aparecerán al terminar.</p>;
  }

  const { metrics, warnings } = result;
  const isCacheHit = metrics.cache === "hit";

  return (
    <div>
      <div className={styles.grid}>
        <div className={styles.metric}>
          <span className={styles.label}>Coste</span>
          <span className={styles.value}>
            ${metrics.costUsd.toFixed(4)}
          </span>
          <span className={styles.sub}>{isCacheHit ? "servido de caché" : "esta petición"}</span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Tokens in</span>
          <span className={styles.value}>{formatTokens(metrics.inputTokens)}</span>
          <span className={styles.sub}>
            {metrics.cacheReadTokens > 0
              ? `${formatTokens(metrics.cacheReadTokens)} cacheados`
              : "sin caché de prompt"}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Tokens out</span>
          <span className={styles.value}>{formatTokens(metrics.outputTokens)}</span>
          <span className={styles.sub}>
            {metrics.cacheCreationTokens > 0
              ? `${formatTokens(metrics.cacheCreationTokens)} escritos`
              : " "}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Modelo</span>
          {/* El nombre del modelo es el dato, no un subtítulo: es lo que se quiere saber de un
              vistazo, sobre todo cuando el fallback puede haberlo cambiado sin avisar. */}
          <span className={styles.value} title={metrics.model}>
            {shortModelName(metrics.model)}
          </span>
          <span className={styles.sub}>
            {metrics.fellBack ? "tras fallback" : "modelo primario"}
          </span>
        </div>

        <div className={styles.metric}>
          <span className={styles.label}>Latencia</span>
          <span className={styles.value}>{formatTotalLatency(metrics.totalMs)}</span>
          <span className={styles.sub}>total extremo a extremo</span>
        </div>
      </div>

      <div className={styles.badges}>
        <span className={clsx(styles.badge, isCacheHit && styles.badgeHit)}>
          caché: {metrics.cache}
        </span>
        <span className={styles.badge}>
          llm {formatMs(metrics.llmMs)} · render {formatMs(metrics.renderMs)}
        </span>
        <span className={styles.badge}>
          {metrics.attempts} {metrics.attempts === 1 ? "intento" : "intentos"}
        </span>
        {metrics.fellBack && (
          <span className={clsx(styles.badge, styles.badgeFallback)}>fallback de modelo</span>
        )}
      </div>

      {warnings.length > 0 && (
        <div className={styles.warnings}>
          <span className={styles.warningsTitle}>Avisos de producción</span>
          <ul className={styles.warningsList}>
            {warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function formatTotalLatency(totalMs: number): string {
  return totalMs >= 1000 ? `${(totalMs / 1000).toFixed(1)}s` : `${String(Math.round(totalMs))}ms`;
}

/** `claude-opus-5` -> `opus-5`. El prefijo es ruido cuando todos los modelos lo comparten. */
export function shortModelName(model: string): string {
  return model.replace(/^claude-/u, "");
}
