import { readFileSync } from "node:fs";
import { z } from "zod";
import { ALL_GRADER_IDS } from "./graders/index.js";
import { THRESHOLDS_PATH } from "./paths.js";
import type { Thresholds } from "./types.js";

/**
 * Los umbrales son datos versionados: subirlos o bajarlos deja rastro en el historial de git,
 * que es la única defensa práctica contra la tentación de aflojar un umbral para que pase el
 * build. Si un umbral cambia, el commit tiene que decir por qué.
 */

const ThresholdsSchema = z
  .object({
    graders: z.record(z.string(), z.number().min(0).max(1)),
    budgets: z
      .object({
        latencyP95Ms: z.number().positive(),
        costPerSpriteUsd: z.number().positive(),
      })
      .strict(),
    minCasePassRate: z.number().min(0).max(1),
  })
  .strict();

export class ThresholdsError extends Error {}

export function loadThresholds(path: string = THRESHOLDS_PATH): Thresholds {
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new ThresholdsError(`no se pudo leer ${path}: ${(error as Error).message}`);
  }

  const parsed = ThresholdsSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<raíz>"}: ${issue.message}`)
      .join("; ");
    throw new ThresholdsError(`thresholds.json inválido: ${issues}`);
  }

  // Un umbral con el id mal escrito no protege nada y no se nota: nunca casa con un grader y la
  // corrida pasa igual. Se comprueba al cargar, no al usarlo.
  const unknown = Object.keys(parsed.data.graders).filter((id) => !ALL_GRADER_IDS.includes(id));
  if (unknown.length > 0) {
    throw new ThresholdsError(
      `thresholds.json declara umbrales para graders inexistentes: ${unknown.join(", ")}.`,
    );
  }

  return parsed.data;
}
