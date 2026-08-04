import type { CaseGrader, GraderResult } from "../types.js";
import { check, noSpecResult, scoreChecks } from "./checks.js";

const DEFAULT_MULTIPLE = 8;

/** Puntuación de un lienzo que no es el exacto pedido pero sí uno legítimo (corrigió). */
const CORRECTED_SCORE = 0.5;

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function isUsableDimension(value: number, multiple: number): boolean {
  return Number.isInteger(value) && value > 0 && (isPowerOfTwo(value) || value % multiple === 0);
}

/**
 * Distingue tres desenlaces, que es justo lo que el caso de "dimensiones no potencia de 2"
 * necesita medir:
 *
 *  - **exacto**: devolvió el lienzo pedido → 1.
 *  - **corregido**: no es el pedido pero es utilizable (potencia de 2 o múltiplo de 8) y cabe
 *    en la cota → 0.5. Es la respuesta correcta ante un prompt imposible, pero no es gratis:
 *    el usuario pidió otra cosa.
 *  - **alucinado**: ni lo pedido ni algo utilizable → 0.
 */
export const canvasConstraintGrader: CaseGrader = {
  id: "canvas-constraint",
  description: "Dimensiones exactas, o al menos utilizables y dentro de la cota.",
  appliesTo: (evalCase) => {
    const { canvas, canvasMax, canvasMultipleOf } = evalCase.expectations;
    return canvas !== undefined || canvasMax !== undefined || canvasMultipleOf !== undefined;
  },
  grade(context): GraderResult {
    const { canvas, canvasMax, canvasMultipleOf } = context.evalCase.expectations;
    if (context.spec === null) return noSpecResult();

    const multiple = canvasMultipleOf ?? DEFAULT_MULTIPLE;
    const actual = context.spec.canvas;
    const size = `${String(actual.width)}x${String(actual.height)}`;

    const withinMax =
      canvasMax === undefined ||
      (actual.width <= canvasMax.width && actual.height <= canvasMax.height);
    const usable =
      isUsableDimension(actual.width, multiple) && isUsableDimension(actual.height, multiple);

    if (canvas !== undefined) {
      if (actual.width === canvas.width && actual.height === canvas.height) {
        return { score: 1, passed: true, detail: `lienzo exacto ${size}` };
      }
      const wanted = `${String(canvas.width)}x${String(canvas.height)}`;
      if (usable && withinMax) {
        return {
          score: CORRECTED_SCORE,
          passed: false,
          detail: `se pedía ${wanted} y devolvió ${size}: utilizable, pero no es lo pedido`,
        };
      }
      return { score: 0, passed: false, detail: `se pedía ${wanted} y devolvió ${size}` };
    }

    return scoreChecks([
      check(
        "dimensiones utilizables",
        usable,
        `${size} no es potencia de 2 ni múltiplo de ${String(multiple)}`,
      ),
      check(
        "dentro de la cota",
        withinMax,
        canvasMax === undefined
          ? ""
          : `${size} excede ${String(canvasMax.width)}x${String(canvasMax.height)}`,
      ),
    ]);
  },
};
