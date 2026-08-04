import type { SpriteSpec } from "@asistente/shared";
import type { CaseGrader } from "../types.js";
import {
  check,
  describeRange,
  noSpecResult,
  rangeSatisfied,
  scoreChecks,
  type Check,
} from "./checks.js";

function orphanFrames(spec: SpriteSpec): number[] {
  const covered = new Set<number>();
  for (const tag of spec.tags) {
    for (let index = tag.from; index <= tag.to; index += 1) covered.add(index);
  }
  return spec.frames.map((frame) => frame.index).filter((index) => !covered.has(index));
}

function overlappingTags(spec: SpriteSpec): string[] {
  const overlaps: string[] = [];
  for (let i = 0; i < spec.tags.length; i += 1) {
    for (let j = i + 1; j < spec.tags.length; j += 1) {
      const a = spec.tags[i];
      const b = spec.tags[j];
      if (a === undefined || b === undefined) continue;
      if (a.from <= b.to && b.from <= a.to) overlaps.push(`${a.name}/${b.name}`);
    }
  }
  return overlaps;
}

/**
 * Coherencia entre la lista de frames y la de tags. Parte se solapa con el `superRefine` de
 * `SpriteSpec` (rangos fuera de límites, nombres duplicados) y eso es deliberado: el grader
 * tiene que seguir midiendo aunque mañana el schema se relaje, y el informe debe decir "el
 * tag se salía del rango", no "Zod falló".
 *
 * Lo que el schema NO mira y aquí sí: frames huérfanos (válidos, pero inalcanzables desde el
 * Animator de Unity), direcciones de tag pedidas por el prompt y duraciones todas iguales
 * (animación sin peso).
 */
export const frameTagCoherenceGrader: CaseGrader = {
  id: "frame-tag-coherence",
  description: "Rangos de tags válidos, sin huérfanos ni solapes, con el ritmo pedido.",
  appliesTo: (evalCase) => {
    const e = evalCase.expectations;
    return (
      e.frames !== undefined ||
      e.tags !== undefined ||
      e.tagDirections !== undefined ||
      e.distinctFrameDurations !== undefined ||
      e.noOrphanFrames !== undefined
    );
  },
  grade(context) {
    if (context.spec === null) return noSpecResult();
    const spec = context.spec;
    const expectations = context.evalCase.expectations;
    const checks: Check[] = [];

    if (expectations.frames !== undefined) {
      const count = spec.frames.length;
      checks.push(
        check(
          "número de frames",
          rangeSatisfied(expectations.frames, count),
          `${String(count)}, se pedía ${describeRange(expectations.frames)}`,
        ),
      );
    }

    if (expectations.tags !== undefined) {
      const count = spec.tags.length;
      checks.push(
        check(
          "número de tags",
          rangeSatisfied(expectations.tags, count),
          `${String(count)}, se pedía ${describeRange(expectations.tags)}`,
        ),
      );
    }

    const maxIndex = spec.frames.length - 1;
    const outOfRange = spec.tags.filter(
      (tag) => tag.from < 0 || tag.to > maxIndex || tag.from > tag.to,
    );
    checks.push(
      check(
        "rangos de tag dentro de los frames",
        outOfRange.length === 0,
        outOfRange.map((tag) => `${tag.name}[${String(tag.from)},${String(tag.to)}]`).join(", "),
      ),
    );

    const overlaps = overlappingTags(spec);
    checks.push(check("tags sin solape", overlaps.length === 0, overlaps.join(", ")));

    const names = spec.tags.map((tag) => tag.name);
    const duplicated = names.filter((name, index) => names.indexOf(name) !== index);
    checks.push(check("nombres de tag únicos", duplicated.length === 0, duplicated.join(", ")));

    if (expectations.tagDirections !== undefined) {
      const present = new Set(spec.tags.map((tag) => tag.direction));
      const missing = expectations.tagDirections.filter((direction) => !present.has(direction));
      checks.push(
        check("direcciones de tag pedidas", missing.length === 0, `faltan: ${missing.join(", ")}`),
      );
    }

    if (expectations.noOrphanFrames === true) {
      const orphans = orphanFrames(spec);
      checks.push(
        check(
          "sin frames huérfanos",
          orphans.length === 0,
          `frame(s) fuera de todo tag: ${orphans.join(", ")}`,
        ),
      );
    }

    if (expectations.distinctFrameDurations === true) {
      const durations = new Set(spec.frames.map((frame) => frame.durationMs));
      checks.push(
        check(
          "duraciones no uniformes",
          durations.size > 1,
          `los ${String(spec.frames.length)} frames duran ${String(spec.frames[0]?.durationMs ?? 0)} ms`,
        ),
      );
    }

    return scoreChecks(checks);
  },
};
