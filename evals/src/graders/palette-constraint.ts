import { TRANSPARENT_TOKEN, type SpriteSpec } from "@asistente/shared";
import type { CaseGrader } from "../types.js";
import { describeRange, noSpecResult, rangeDistance, rangeSatisfied } from "./checks.js";

/** Peso de "está dentro del número pedido" frente a "los colores declarados se usan". */
const STRUCTURAL_WEIGHT = 0.75;
const USAGE_WEIGHT = 1 - STRUCTURAL_WEIGHT;

function usedTokens(spec: SpriteSpec): Set<string> {
  const used = new Set<string>();
  for (const frame of spec.frames) {
    for (const row of frame.pixels) {
      for (const char of row) {
        if (char !== TRANSPARENT_TOKEN) used.add(char);
      }
    }
  }
  return used;
}

/**
 * Mide dos cosas distintas que el prompt del usuario mete en la misma frase ("5 colores"):
 *
 *  1. **Estructural** — el tamaño de `palette` cae dentro de lo pedido. Puntúa de forma
 *     continua: pasarse en uno no puede valer lo mismo que triplicar la paleta.
 *  2. **Uso real** — cada color declarado pinta al menos un píxel. Declarar 5 y usar 3 es la
 *     forma barata de "cumplir" una restricción de paleta, y el spec sigue siendo válido para
 *     Zod: si no se mide aquí, no lo mide nadie.
 */
export const paletteConstraintGrader: CaseGrader = {
  id: "palette-constraint",
  description: "El número de colores respeta lo pedido y todos se usan.",
  appliesTo: (evalCase) => evalCase.expectations.palette !== undefined,
  grade(context) {
    const range = context.evalCase.expectations.palette;
    if (range === undefined) return { score: 1, passed: true, detail: "sin restricción de paleta" };
    if (context.spec === null) return noSpecResult();

    const spec = context.spec;
    const declared = spec.palette.length;
    const structuralOk = rangeSatisfied(range, declared);
    const structuralScore = 1 - rangeDistance(range, declared);

    const used = usedTokens(spec);
    const unused = spec.palette.filter((entry) => !used.has(entry.token));
    const usageScore = declared === 0 ? 0 : (declared - unused.length) / declared;

    const score = STRUCTURAL_WEIGHT * structuralScore + USAGE_WEIGHT * usageScore;
    const passed = structuralOk && unused.length === 0;

    const parts = [`${String(declared)} color(es), se pedía ${describeRange(range)}`];
    if (unused.length > 0) {
      parts.push(`sin usar: ${unused.map((entry) => `${entry.token}=${entry.hex}`).join(", ")}`);
    }
    return { score, passed, detail: parts.join(" | ") };
  },
};
