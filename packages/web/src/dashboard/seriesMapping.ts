import { MODEL_IDS, type StageLatency } from "@asistente/shared";
import { seriesColor } from "./charts/primitives.js";

/**
 * Asignación de color por ENTIDAD (modelo, etapa), nunca por su posición en los datos.
 *
 * Es la regla que hace comparables dos vistas del mismo panel. El servidor devuelve `byModel`
 * ordenado por número de peticiones — un rango —, y `StageChart` descarta las etapas de 0 ms.
 * Si el color saliera de esos índices, bastaría cambiar de ventana para que dos series
 * intercambiaran color y el lector viera un cambio que no ha ocurrido.
 *
 * `MODEL_IDS` y `STAGE_ORDER` son tuplas fijas: el slot de cada entidad es el mismo en todos
 * los gráficos y en todas las ventanas.
 */

/** Orden canónico de las etapas: el del pipeline, que además es el del gráfico apilado. */
export const STAGE_ORDER = ["llm", "validate", "render"] as const;

function slotOf<T extends string>(value: string, order: readonly T[]): number {
  const index = order.indexOf(value as T);
  // Una entidad desconocida cae al primer slot libre tras los conocidos, nunca a uno ocupado.
  return index === -1 ? order.length : index;
}

export function modelColor(model: string): string {
  return seriesColor(slotOf(model, MODEL_IDS));
}

export function stageColor(stage: StageLatency["stage"]): string {
  return seriesColor(slotOf(stage, STAGE_ORDER));
}

/**
 * Ordena los modelos presentes según el orden canónico, para que las capas del gráfico se
 * apilen siempre igual. Los desconocidos van al final, alfabéticamente.
 */
export function sortModels(models: readonly string[]): string[] {
  return [...models].sort(
    (a, b) => slotOf(a, MODEL_IDS) - slotOf(b, MODEL_IDS) || a.localeCompare(b),
  );
}
