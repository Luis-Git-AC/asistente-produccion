import type { SpriteSpec } from "@asistente/shared";
import type { RunGrader } from "../types.js";
import { check, scoreChecks, type Check } from "./checks.js";

/** Margen tolerado en el tamaño de paleta entre dos prompts equivalentes. */
const PALETTE_TOLERANCE = 1;

function comparePair(idA: string, a: SpriteSpec, idB: string, b: SpriteSpec): Check[] {
  const pair = `${idA} vs ${idB}`;
  return [
    check(`${pair}: mismo kind`, a.kind === b.kind, `${a.kind} vs ${b.kind}`),
    check(
      `${pair}: mismo lienzo`,
      a.canvas.width === b.canvas.width && a.canvas.height === b.canvas.height,
      `${String(a.canvas.width)}x${String(a.canvas.height)} vs ${String(b.canvas.width)}x${String(b.canvas.height)}`,
    ),
    check(
      `${pair}: mismo número de frames`,
      a.frames.length === b.frames.length,
      `${String(a.frames.length)} vs ${String(b.frames.length)}`,
    ),
    check(
      `${pair}: paleta comparable`,
      Math.abs(a.palette.length - b.palette.length) <= PALETTE_TOLERANCE,
      `${String(a.palette.length)} vs ${String(b.palette.length)} colores`,
    ),
  ];
}

/**
 * Consistencia entre un prompt y su equivalente en el otro idioma. El mismo encargo escrito en
 * español y en inglés debe producir el mismo sprite salvo por el texto libre: si el idioma
 * cambia el lienzo o el número de frames, el sistema no está interpretando el encargo, está
 * reaccionando a la superficie del prompt.
 *
 * Devuelve `null` si la corrida no contiene ningún par completo — con `--case <id>` es lo
 * normal, y puntuar 1 en ese caso sería inventarse una medida que no se ha hecho.
 */
export const crossLanguageConsistencyGrader: RunGrader = {
  id: "cross-language-consistency",
  description: "Un prompt y su equivalente en otro idioma producen el mismo sprite.",
  grade({ outcomes, casesById }) {
    const byId = new Map(outcomes.map((outcome) => [outcome.caseId, outcome]));
    const checks: Check[] = [];
    const compared = new Set<string>();

    for (const outcome of outcomes) {
      const counterpartId = casesById.get(outcome.caseId)?.expectations.equivalentTo;
      if (counterpartId === undefined) continue;

      const pairKey = [outcome.caseId, counterpartId]
        .sort((a, b) => a.localeCompare(b, "en"))
        .join("|");
      if (compared.has(pairKey)) continue;

      const counterpart = byId.get(counterpartId);
      if (counterpart === undefined) continue;
      compared.add(pairKey);

      if (outcome.spec === null || counterpart.spec === null) {
        checks.push(
          check(
            `${outcome.caseId} vs ${counterpartId}`,
            false,
            "uno de los dos no produjo un spec válido",
          ),
        );
        continue;
      }
      checks.push(...comparePair(outcome.caseId, outcome.spec, counterpartId, counterpart.spec));
    }

    if (checks.length === 0) return null;
    return scoreChecks(checks);
  },
};
