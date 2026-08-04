import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { MODEL_IDS, type ModelId } from "@asistente/shared";
import { z } from "zod";
import type { EvalCase } from "./cases.js";
import { FIXTURES_DIR } from "./paths.js";

/**
 * Respuestas grabadas para poder correr la suite entera en cada PR sin red y sin gastar API.
 *
 * **La clave de un fixture es determinista y sólo depende del caso y del modelo**: nada de
 * `Date.now()`, nada de contadores, nada de hashes del contenido. El mismo caso resuelve siempre
 * al mismo fichero, así que el diff de una regrabación se lee como un diff normal y el fixture
 * de un caso se puede abrir a mano sin buscarlo por hash.
 *
 * `promptSha256` no participa en la clave: sirve para detectar que el prompt del caso cambió
 * después de grabar. Un fixture obsoleto es peor que no tenerlo — mide el sistema de ayer y lo
 * presenta como el de hoy —, así que se trata como error duro y no como aviso.
 */

const UsageSchema = z
  .object({
    input_tokens: z.number().int().nonnegative(),
    output_tokens: z.number().int().nonnegative(),
    cache_read_input_tokens: z.number().int().nonnegative(),
    cache_creation_input_tokens: z.number().int().nonnegative(),
  })
  .strict();

export const FixtureSchema = z
  .object({
    caseId: z.string().min(1),
    model: z.enum(MODEL_IDS),
    /** Modelo que sirvió realmente la respuesta; puede diferir por fallback. */
    servedByModel: z.string().min(1),
    promptSha256: z.string().regex(/^[0-9a-f]{64}$/u),
    /**
     * `recorded`: salida real de la API vía `--record`.
     * `synthetic-seed`: semilla escrita a mano para que la suite arranque sin API key.
     */
    origin: z.enum(["recorded", "synthetic-seed"]),
    recordedAt: z.string().min(1),
    latencyMs: z.number().nonnegative(),
    usage: UsageSchema,
    /** Texto crudo de la respuesta, tal cual: el runner lo parsea con el mismo código que en vivo. */
    responseText: z.string().min(1),
  })
  .strict();

export type Fixture = z.infer<typeof FixtureSchema>;

export class FixtureError extends Error {}

export function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/** Clave determinista de un fixture: caso + modelo, y nada más. */
export function fixtureFileName(caseId: string, model: ModelId): string {
  return `${caseId}.${model}.json`;
}

export function fixturePath(caseId: string, model: ModelId): string {
  return join(FIXTURES_DIR, fixtureFileName(caseId, model));
}

export function loadFixture(evalCase: EvalCase, model: ModelId): Fixture {
  const path = fixturePath(evalCase.id, model);
  if (!existsSync(path)) {
    throw new FixtureError(
      `falta el fixture ${fixtureFileName(evalCase.id, model)}. ` +
        `Grábalo con: npm run evals:record -- --case ${evalCase.id}`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new FixtureError(
      `${fixtureFileName(evalCase.id, model)}: JSON inválido — ${(error as Error).message}`,
    );
  }

  const parsed = FixtureSchema.safeParse(raw);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<raíz>"}: ${issue.message}`)
      .join("; ");
    throw new FixtureError(`${fixtureFileName(evalCase.id, model)}: ${issues}`);
  }

  const fixture = parsed.data;
  if (fixture.caseId !== evalCase.id) {
    throw new FixtureError(
      `${fixtureFileName(evalCase.id, model)}: declara caseId "${fixture.caseId}".`,
    );
  }

  const expectedHash = sha256(evalCase.prompt);
  if (fixture.promptSha256 !== expectedHash) {
    throw new FixtureError(
      `fixture obsoleto para "${evalCase.id}": el prompt del caso cambió desde que se grabó. ` +
        `Regrábalo con: npm run evals:record -- --case ${evalCase.id}`,
    );
  }

  return fixture;
}

export function writeFixture(fixture: Fixture): string {
  mkdirSync(FIXTURES_DIR, { recursive: true });
  const path = fixturePath(fixture.caseId, fixture.model);
  writeFileSync(path, `${JSON.stringify(fixture, null, 2)}\n`, "utf8");
  return path;
}
