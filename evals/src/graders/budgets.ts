import type { CaseOutcome, RunGrader } from "../types.js";
import { mean, percentile } from "./checks.js";

/**
 * Los presupuestos se miden sólo sobre los casos que llegaron a producir una respuesta.
 * Un fallo de transporte tiene latencia y coste cercanos a cero: contarlo abarataría la media
 * y bajaría el p95 justo cuando el sistema está peor — el mismo error que en el dashboard
 * obliga a excluir los cache hits del percentil de LLM.
 */
function measurable(outcomes: readonly CaseOutcome[]): CaseOutcome[] {
  return outcomes.filter((outcome) => outcome.transportError === null);
}

/** `score` = cuánto margen queda sobre el presupuesto, saturado a 1. */
function budgetScore(actual: number, budget: number): number {
  if (actual <= 0) return 1;
  if (budget <= 0) return 0;
  return Math.min(1, budget / actual);
}

export const latencyBudgetGrader: RunGrader = {
  id: "latency-budget",
  description: "p95 de latencia por sprite bajo presupuesto.",
  grade({ outcomes, budgets }) {
    const usable = measurable(outcomes);
    if (usable.length === 0) return null;

    const p95 = percentile(
      usable.map((outcome) => outcome.latencyMs),
      95,
    );
    const passed = p95 <= budgets.latencyP95Ms;
    return {
      score: budgetScore(p95, budgets.latencyP95Ms),
      passed,
      detail:
        `p95 ${p95.toFixed(0)} ms sobre ${String(usable.length)} caso(s), ` +
        `presupuesto ${String(budgets.latencyP95Ms)} ms`,
    };
  },
};

export const costBudgetGrader: RunGrader = {
  id: "cost-budget",
  description: "Coste medio por sprite bajo presupuesto.",
  grade({ outcomes, budgets }) {
    const usable = measurable(outcomes);
    if (usable.length === 0) return null;

    const average = mean(usable.map((outcome) => outcome.costUsd));
    const passed = average <= budgets.costPerSpriteUsd;
    return {
      score: budgetScore(average, budgets.costPerSpriteUsd),
      passed,
      detail:
        `$${average.toFixed(4)} por sprite sobre ${String(usable.length)} caso(s), ` +
        `presupuesto $${budgets.costPerSpriteUsd.toFixed(4)}`,
    };
  },
};
