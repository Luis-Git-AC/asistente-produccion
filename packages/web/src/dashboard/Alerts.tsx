import type { DashboardAlert } from "@asistente/shared";
import styles from "./Alerts.module.css";

/**
 * Alertas del panel.
 *
 * El color de estado va SIEMPRE acompañado de icono y de una etiqueta escrita ("aviso" /
 * "crítico"): el nivel nunca se transmite sólo por color. Y cada alerta trae su acción — una
 * alerta que no dice qué hacer es ruido con formato de urgencia.
 */
const LEVEL_LABEL = { warning: "Aviso", critical: "Crítico" } as const;
const LEVEL_ICON = { warning: "▲", critical: "●" } as const;

export function Alerts({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) {
    return (
      <p className={styles.clear}>
        <span aria-hidden="true">✓</span> Sin alertas: coste por sprite, tasa de fallback y caché
        dentro de umbral.
      </p>
    );
  }

  return (
    <ul className={styles.list}>
      {alerts.map((alert) => (
        <li
          key={alert.id}
          className={alert.level === "critical" ? styles.critical : styles.warning}
        >
          <span className={styles.badge}>
            <span aria-hidden="true">{LEVEL_ICON[alert.level]}</span>
            {LEVEL_LABEL[alert.level]}
          </span>
          <div className={styles.content}>
            <p className={styles.title}>{alert.title}</p>
            <p className={styles.detail}>{alert.detail}</p>
            <p className={styles.action}>{alert.action}</p>
          </div>
        </li>
      ))}
    </ul>
  );
}
