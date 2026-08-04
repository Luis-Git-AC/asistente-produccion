import { useMemo, useState } from "react";
import type { RecentRequest } from "@asistente/shared";
import styles from "./RecentTable.module.css";
import { formatMs, formatTime, formatTokens, formatUsd } from "./charts/primitives.js";

/**
 * Tabla de peticiones recientes.
 *
 * Además de ser útil por sí misma, es la VISTA DE TABLA que exige la regla de accesibilidad:
 * en modo claro dos de los cuatro colores de serie no llegan a 3:1 sobre blanco, y el relieve
 * obligatorio es que todo dato del panel sea legible también como cifra. Aquí lo es.
 */

type SortKey = "createdAt" | "costUsd" | "totalMs" | "llmMs" | "outputTokens";

interface Column {
  key: SortKey | null;
  label: string;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: "createdAt", label: "Cuándo" },
  { key: null, label: "Prompt" },
  { key: null, label: "Modelo" },
  { key: null, label: "Caché" },
  { key: "outputTokens", label: "Tokens", numeric: true },
  { key: "costUsd", label: "Coste", numeric: true },
  { key: "llmMs", label: "Modelo (ms)", numeric: true },
  { key: "totalMs", label: "Total", numeric: true },
  { key: null, label: "Estado" },
];

export function RecentTable({ rows }: { rows: RecentRequest[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [descending, setDescending] = useState(true);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => (descending ? b[sortKey] - a[sortKey] : a[sortKey] - b[sortKey]));
    return copy;
  }, [rows, sortKey, descending]);

  if (rows.length === 0) {
    return <p className={styles.empty}>Sin peticiones en esta ventana.</p>;
  }

  const toggle = (key: SortKey) => {
    if (key === sortKey) {
      setDescending((value) => !value);
      return;
    }
    setSortKey(key);
    // Al cambiar de columna se empieza por descendente: lo interesante es siempre lo más alto.
    setDescending(true);
  };

  return (
    <div className={styles.scroll}>
      <table className={styles.table}>
        <thead>
          <tr>
            {COLUMNS.map((column) => (
              <th
                key={column.label}
                scope="col"
                className={column.numeric === true ? styles.numeric : undefined}
                aria-sort={
                  column.key === sortKey ? (descending ? "descending" : "ascending") : undefined
                }
              >
                {column.key === null ? (
                  column.label
                ) : (
                  <button
                    type="button"
                    className={styles.sortButton}
                    onClick={() => {
                      toggle(column.key as SortKey);
                    }}
                  >
                    {column.label}
                    <span aria-hidden="true" className={styles.caret}>
                      {column.key === sortKey ? (descending ? "▼" : "▲") : "↕"}
                    </span>
                  </button>
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sorted.map((row) => (
            <tr key={row.requestId}>
              <td className={styles.when}>{formatTime(row.createdAt)}</td>
              <td className={styles.prompt} title={row.promptPreview}>
                {row.spritesheetUrl === null ? (
                  row.promptPreview
                ) : (
                  <a href={row.spritesheetUrl} target="_blank" rel="noreferrer">
                    {row.promptPreview}
                  </a>
                )}
              </td>
              <td className={styles.model}>
                {row.model.replace(/^claude-/u, "")}
                {row.fellBack && <span className={styles.tag}>fallback</span>}
                {row.attempts > 1 && (
                  <span className={styles.tag}>{row.attempts} intentos</span>
                )}
              </td>
              <td>
                <span className={row.cache === "hit" ? styles.hit : styles.miss}>
                  {row.cache === "hit" ? "acierto" : "fallo"}
                </span>
              </td>
              <td className={styles.numeric}>
                {formatTokens(row.inputTokens)} / {formatTokens(row.outputTokens)}
              </td>
              <td className={styles.numeric}>{formatUsd(row.costUsd)}</td>
              <td className={styles.numeric}>{formatMs(row.llmMs)}</td>
              <td className={styles.numeric}>{formatMs(row.totalMs)}</td>
              <td>
                {row.status === "ok" ? (
                  <span className={styles.ok}>ok</span>
                ) : (
                  <span className={styles.error} title={row.errorCode ?? undefined}>
                    {row.errorCode ?? "error"}
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
