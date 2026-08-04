import type { CaseGrader, RunGrader } from "../types.js";
import { costBudgetGrader, latencyBudgetGrader } from "./budgets.js";
import { canvasConstraintGrader } from "./canvas-constraint.js";
import { crossLanguageConsistencyGrader } from "./cross-language.js";
import { frameTagCoherenceGrader } from "./frame-tag-coherence.js";
import { luaSingleTransactionGrader } from "./lua-single-transaction.js";
import { paletteConstraintGrader } from "./palette-constraint.js";
import { pixelMapIntegrityGrader } from "./pixel-map-integrity.js";
import { schemaValidGrader } from "./schema-valid.js";

/**
 * Registro único de graders. El orden es el del informe y el de la tabla en consola: primero
 * lo que decide si el output existe (`schema-valid`), luego lo que mide si cumple el encargo,
 * y al final lo que mide si es materializable en Aseprite.
 *
 * Ningún grader del set base usa LLM-as-judge: un grader que llama al modelo introduce ruido y
 * coste en la medida que sirve para juzgar al modelo. El juez opcional vive en `optional/` y
 * nunca cuenta para el código de salida.
 */
export const CASE_GRADERS: readonly CaseGrader[] = [
  schemaValidGrader,
  paletteConstraintGrader,
  canvasConstraintGrader,
  frameTagCoherenceGrader,
  pixelMapIntegrityGrader,
  luaSingleTransactionGrader,
];

export const RUN_GRADERS: readonly RunGrader[] = [
  latencyBudgetGrader,
  costBudgetGrader,
  crossLanguageConsistencyGrader,
];

export const ALL_GRADER_IDS: readonly string[] = [
  ...CASE_GRADERS.map((grader) => grader.id),
  ...RUN_GRADERS.map((grader) => grader.id),
];

export {
  canvasConstraintGrader,
  costBudgetGrader,
  crossLanguageConsistencyGrader,
  frameTagCoherenceGrader,
  latencyBudgetGrader,
  luaSingleTransactionGrader,
  paletteConstraintGrader,
  pixelMapIntegrityGrader,
  schemaValidGrader,
};
