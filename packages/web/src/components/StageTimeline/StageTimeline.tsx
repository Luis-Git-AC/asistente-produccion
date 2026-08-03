import clsx from "clsx";
import { Fragment } from "react";
import { GENERATION_STAGES, type GenerationStage } from "@asistente/shared";
import type { GenerationStatus, StageRecord } from "../../hooks/useGeneration.js";
import styles from "./StageTimeline.module.css";

const STAGE_LABEL: Record<GenerationStage, string> = {
  cache: "caché",
  llm: "modelo",
  validate: "validar",
  render: "render",
  export: "export",
};

type StageState = "pending" | "active" | "done" | "skipped" | "failed";

interface StageTimelineProps {
  stages: StageRecord[];
  status: GenerationStatus;
}

/**
 * Calcula el estado visual de cada etapa.
 *
 * La etapa `llm` puede no aparecer nunca: en un cache hit el servidor no la emite. Se marca como
 * `skipped` en vez de dejarla pendiente para siempre, que es lo que haría un timeline ingenuo.
 */
function resolveStageStates(
  stages: StageRecord[],
  status: GenerationStatus,
): Map<GenerationStage, { state: StageState; elapsedMs: number | null }> {
  const seen = new Map(stages.map((record) => [record.stage, record.elapsedMs]));
  const lastSeen = stages.at(-1)?.stage;
  const result = new Map<GenerationStage, { state: StageState; elapsedMs: number | null }>();

  for (const stage of GENERATION_STAGES) {
    const elapsedMs = seen.get(stage) ?? null;

    if (elapsedMs === null) {
      // Una etapa no vista pero posterior a otra ya vista se saltó (caso: cache hit y `llm`).
      const laterStageSeen = stages.some(
        (record) => GENERATION_STAGES.indexOf(record.stage) > GENERATION_STAGES.indexOf(stage),
      );
      result.set(stage, { state: laterStageSeen ? "skipped" : "pending", elapsedMs: null });
      continue;
    }

    if (status === "error" && stage === lastSeen) {
      result.set(stage, { state: "failed", elapsedMs });
    } else if (stage === lastSeen && status !== "done") {
      result.set(stage, { state: "active", elapsedMs });
    } else {
      result.set(stage, { state: "done", elapsedMs });
    }
  }

  return result;
}

function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${String(Math.round(ms))}ms`;
}

export function StageTimeline({ stages, status }: StageTimelineProps) {
  const states = resolveStageStates(stages, status);
  const current = stages.at(-1)?.stage;

  return (
    <ol
      className={styles.timeline}
      aria-label="Progreso de la generación"
      // El lector de pantalla anuncia el cambio de etapa sin robar el foco.
      aria-live="polite"
      aria-atomic="false"
    >
      {GENERATION_STAGES.map((stage, index) => {
        const entry = states.get(stage);
        const state = entry?.state ?? "pending";
        const isLast = index === GENERATION_STAGES.length - 1;

        return (
          <Fragment key={stage}>
            <li
              className={clsx(styles.item, styles[state])}
              aria-current={stage === current && status !== "done" ? "step" : undefined}
            >
              <div className={styles.step}>
                <span className={styles.dot} aria-hidden="true">
                  {state === "active" ? (
                    <span className={styles.pulse} />
                  ) : state === "done" ? (
                    "✓"
                  ) : state === "failed" ? (
                    "!"
                  ) : state === "skipped" ? (
                    "–"
                  ) : (
                    ""
                  )}
                </span>
                <span className={styles.name}>{STAGE_LABEL[stage]}</span>
                <span className={styles.latency}>
                  {state === "skipped"
                    ? "omitida"
                    : entry?.elapsedMs != null
                      ? formatMs(entry.elapsedMs)
                      : ""}
                </span>
              </div>
            </li>
            {!isLast && (
              <span
                className={clsx(
                  styles.connector,
                  (state === "done" || state === "skipped") && styles.connectorDone,
                )}
                aria-hidden="true"
              />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}
