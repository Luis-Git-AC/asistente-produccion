import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { SPRITE_KINDS, TAG_DIRECTIONS } from "@asistente/shared";
import { z } from "zod";
import { CASES_DIR } from "./paths.js";

/**
 * Los casos son datos versionados, no código: viven en `evals/cases/*.json` y se validan al
 * cargarlos. Un caso mal escrito tiene que romper con un mensaje que señale el fichero y el
 * campo, no colarse y producir un grader que no mide nada.
 *
 * Aquí SÍ se usan `.int()`, `.min()` y `.regex()`: este schema nunca viaja a la API, así que
 * no le aplica la restricción de structured outputs de `packages/shared`.
 */

const CASE_ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

const CountRangeSchema = z
  .object({
    exact: z.number().int().nonnegative().optional(),
    min: z.number().int().nonnegative().optional(),
    max: z.number().int().nonnegative().optional(),
  })
  .strict()
  .refine(
    (range) => range.exact !== undefined || range.min !== undefined || range.max !== undefined,
    { message: "un rango vacío no mide nada: declara exact, min o max" },
  );

export type CountRange = z.infer<typeof CountRangeSchema>;

const DimensionsSchema = z
  .object({
    width: z.number().int().positive(),
    height: z.number().int().positive(),
  })
  .strict();

export const ExpectationsSchema = z
  .object({
    kind: z.enum(SPRITE_KINDS).optional(),
    /** Dimensiones exactas exigidas por el prompt. */
    canvas: DimensionsSchema.optional(),
    /** Cota superior cuando el prompt no fija dimensiones (casos ambiguos). */
    canvasMax: DimensionsSchema.optional(),
    /** Divisor exigido a ambas dimensiones cuando no hay exactas. Por defecto 8. */
    canvasMultipleOf: z.number().int().positive().optional(),
    palette: CountRangeSchema.optional(),
    frames: CountRangeSchema.optional(),
    tags: CountRangeSchema.optional(),
    /** Cada una de estas direcciones debe aparecer en al menos un tag. */
    tagDirections: z.array(z.enum(TAG_DIRECTIONS)).nonempty().optional(),
    /** El prompt pide ritmo: no todos los frames pueden durar lo mismo. */
    distinctFrameDurations: z.boolean().optional(),
    /** Ningún frame puede quedarse fuera de todos los tags. */
    noOrphanFrames: z.boolean().optional(),
    /** Fracción mínima de píxeles opacos por frame (0..1). Por defecto 0.05. */
    minOpaqueRatio: z.number().min(0).max(1).optional(),
    /** Id del caso equivalente en el otro idioma; habilita `cross-language-consistency`. */
    equivalentTo: z.string().optional(),
  })
  .strict();

export type Expectations = z.infer<typeof ExpectationsSchema>;

export const EvalCaseSchema = z
  .object({
    id: z.string().regex(CASE_ID_RE, "el id debe ser un slug en kebab-case"),
    prompt: z.string().min(1),
    expectations: ExpectationsSchema,
    tags: z.array(z.string().min(1)).nonempty(),
    /** Nota para quien lea el caso: qué se está midiendo y por qué. No lo usa ningún grader. */
    notes: z.string().optional(),
  })
  .strict();

export type EvalCase = z.infer<typeof EvalCaseSchema>;

export class CaseLoadError extends Error {}

function parseCaseFile(fileName: string): EvalCase {
  const path = join(CASES_DIR, fileName);
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new CaseLoadError(`${fileName}: JSON inválido — ${(error as Error).message}`);
  }

  const parsed = EvalCaseSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<raíz>"}: ${issue.message}`)
      .join("; ");
    throw new CaseLoadError(`${fileName}: ${issues}`);
  }
  return parsed.data;
}

/**
 * Carga todos los casos ordenados por nombre de fichero. El orden es estable a propósito:
 * el informe de dos corridas distintas tiene que poder compararse línea a línea.
 */
export function loadCases(): EvalCase[] {
  const fileNames = readdirSync(CASES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort((a, b) => a.localeCompare(b, "en"));

  const cases = fileNames.map(parseCaseFile);

  const seen = new Set<string>();
  for (const evalCase of cases) {
    if (seen.has(evalCase.id)) {
      throw new CaseLoadError(`id de caso duplicado: "${evalCase.id}".`);
    }
    seen.add(evalCase.id);
  }

  for (const evalCase of cases) {
    const counterpart = evalCase.expectations.equivalentTo;
    if (counterpart !== undefined && !seen.has(counterpart)) {
      throw new CaseLoadError(
        `el caso "${evalCase.id}" declara equivalentTo "${counterpart}", que no existe.`,
      );
    }
    if (counterpart === evalCase.id) {
      throw new CaseLoadError(`el caso "${evalCase.id}" se declara equivalente a sí mismo.`);
    }
  }

  return cases;
}

export function filterCases(cases: readonly EvalCase[], ids: readonly string[]): EvalCase[] {
  if (ids.length === 0) return [...cases];
  const wanted = new Set(ids);
  const selected = cases.filter((evalCase) => wanted.has(evalCase.id));
  const missing = ids.filter((id) => !cases.some((evalCase) => evalCase.id === id));
  if (missing.length > 0) {
    throw new CaseLoadError(`caso(s) inexistente(s): ${missing.join(", ")}.`);
  }
  return selected;
}
