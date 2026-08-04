import type { CaseGrader } from "../types.js";

/**
 * Binario: el texto devuelto por el modelo parsea como JSON y valida contra `SpriteSpec`,
 * incluidos los invariantes cruzados del `superRefine` (índices de paleta, filas del pixel-map,
 * rangos de tags). Es el único grader que aplica a todos los casos sin excepción, y su umbral
 * es 1.0: un spec inválido no es un sprite peor, es un sprite que no existe.
 */
export const schemaValidGrader: CaseGrader = {
  id: "schema-valid",
  description: "El output parsea y valida contra SpriteSpec.",
  appliesTo: () => true,
  grade(context) {
    const { spec, issues } = context;
    if (spec === null) {
      const shown = issues.slice(0, 3).join(" | ");
      const rest = issues.length > 3 ? ` (+${String(issues.length - 3)} más)` : "";
      return { score: 0, passed: false, detail: `inválido — ${shown}${rest}` };
    }
    return {
      score: 1,
      passed: true,
      detail:
        `válido: ${spec.kind} ${String(spec.canvas.width)}x${String(spec.canvas.height)}, ` +
        `${String(spec.frames.length)} frame(s), ${String(spec.palette.length)} color(es), ` +
        `${String(spec.tags.length)} tag(s)`,
    };
  },
};
