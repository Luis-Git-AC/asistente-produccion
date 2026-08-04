import type { CountRange } from "../cases.js";
import type { GraderResult } from "../types.js";

/**
 * Una comprobación nombrada. Los graders se construyen como listas de comprobaciones en vez de
 * como un booleano gordo para que el `score` degrade de forma continua (5/6 ≠ 0/6) y para que
 * el `detail` diga exactamente CUÁL falló. Un grader que sólo sabe decir "no pasa" obliga a
 * reproducir el caso a mano, que es justo el trabajo que la suite existe para ahorrar.
 */
export interface Check {
  label: string;
  passed: boolean;
  /** Qué se observó. Se incluye en el `detail` del grader tanto si pasa como si no. */
  observed: string;
}

export function check(label: string, passed: boolean, observed: string): Check {
  return { label, passed, observed };
}

export function scoreChecks(checks: readonly Check[]): GraderResult {
  if (checks.length === 0) {
    return { score: 1, passed: true, detail: "sin comprobaciones aplicables" };
  }
  const failed = checks.filter((item) => !item.passed);
  const score = (checks.length - failed.length) / checks.length;
  const detail =
    failed.length === 0
      ? `${String(checks.length)}/${String(checks.length)} comprobaciones OK`
      : failed.map((item) => `${item.label}: ${item.observed}`).join(" | ");
  return { score, passed: failed.length === 0, detail };
}

/** Resultado sin spec válido: todos los graders posteriores puntúan 0, nunca "no aplica". */
export function noSpecResult(): GraderResult {
  return {
    score: 0,
    passed: false,
    detail: "no hay SpriteSpec válido que medir (ver schema-valid)",
  };
}

export function rangeSatisfied(range: CountRange, value: number): boolean {
  if (range.exact !== undefined && value !== range.exact) return false;
  if (range.min !== undefined && value < range.min) return false;
  if (range.max !== undefined && value > range.max) return false;
  return true;
}

export function describeRange(range: CountRange): string {
  if (range.exact !== undefined) return `exactamente ${String(range.exact)}`;
  const parts: string[] = [];
  if (range.min !== undefined) parts.push(`≥ ${String(range.min)}`);
  if (range.max !== undefined) parts.push(`≤ ${String(range.max)}`);
  return parts.join(" y ");
}

/**
 * Distancia relativa de `value` al rango, en 0..1 (0 = dentro, 1 = absurdamente lejos).
 * Permite que "pidieron 5 colores y usó 6" puntúe muy por encima de "usó 16".
 */
export function rangeDistance(range: CountRange, value: number): number {
  const target = range.exact ?? range.max ?? range.min ?? 0;
  const reference = Math.max(target, 1);
  if (rangeSatisfied(range, value)) return 0;

  let overflow = 0;
  if (range.exact !== undefined) overflow = Math.abs(value - range.exact);
  else if (range.max !== undefined && value > range.max) overflow = value - range.max;
  else if (range.min !== undefined && value < range.min) overflow = range.min - value;

  return Math.min(1, overflow / reference);
}

/** Percentil por interpolación lineal. `values` vacío devuelve 0. */
export function percentile(values: readonly number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (rank - low);
}

export function mean(values: readonly number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}
