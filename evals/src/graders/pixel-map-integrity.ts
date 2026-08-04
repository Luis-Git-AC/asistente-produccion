import { TRANSPARENT_TOKEN, type SpriteSpec } from "@asistente/shared";
import type { CaseGrader } from "../types.js";
import { check, noSpecResult, scoreChecks, type Check } from "./checks.js";

const DEFAULT_MIN_OPAQUE_RATIO = 0.05;

interface FrameStats {
  index: number;
  rows: number;
  badRows: number[];
  unknownChars: string[];
  opaque: number;
}

function analyseFrame(spec: SpriteSpec, frameIndex: number): FrameStats {
  const frame = spec.frames[frameIndex];
  const tokens = new Set(spec.palette.map((entry) => entry.token));
  const stats: FrameStats = {
    index: frameIndex,
    rows: frame?.pixels.length ?? 0,
    badRows: [],
    unknownChars: [],
    opaque: 0,
  };
  if (frame === undefined) return stats;

  frame.pixels.forEach((row, rowIndex) => {
    if (row.length !== spec.canvas.width) stats.badRows.push(rowIndex);
    for (const char of row) {
      if (char === TRANSPARENT_TOKEN) continue;
      if (!tokens.has(char)) {
        if (!stats.unknownChars.includes(char)) stats.unknownChars.push(char);
        continue;
      }
      stats.opaque += 1;
    }
  });
  return stats;
}

/**
 * Integridad del pixel-map: la parte del spec que de verdad se convierte en píxeles.
 *
 * Las tres primeras comprobaciones (altura, anchura homogénea, índices existentes) duplican al
 * schema a propósito — ver el comentario de `frame-tag-coherence`. Las dos últimas no las mira
 * nadie más y son las que pillan la trampa clásica del modelo cuando el pixel-map se le hace
 * largo: devolver un lienzo casi vacío que valida perfectamente y no se ve.
 */
export const pixelMapIntegrityGrader: CaseGrader = {
  id: "pixel-map-integrity",
  description: "Filas homogéneas, índices existentes y frames con contenido real.",
  appliesTo: () => true,
  grade(context) {
    if (context.spec === null) return noSpecResult();
    const spec = context.spec;
    const minRatio = context.evalCase.expectations.minOpaqueRatio ?? DEFAULT_MIN_OPAQUE_RATIO;
    const area = spec.canvas.width * spec.canvas.height;

    const stats = spec.frames.map((_frame, index) => analyseFrame(spec, index));

    const wrongHeight = stats.filter((frame) => frame.rows !== spec.canvas.height);
    const wrongWidth = stats.filter((frame) => frame.badRows.length > 0);
    const unknown = stats.filter((frame) => frame.unknownChars.length > 0);
    const empty = stats.filter((frame) => frame.opaque === 0);
    const thin = stats.filter((frame) => frame.opaque > 0 && frame.opaque / area < minRatio);

    const checks: Check[] = [
      check(
        "altura de cada frame",
        wrongHeight.length === 0,
        wrongHeight
          .map((frame) => `frame ${String(frame.index)}: ${String(frame.rows)} filas`)
          .join(", "),
      ),
      check(
        "filas homogéneas",
        wrongWidth.length === 0,
        wrongWidth
          .map((frame) => `frame ${String(frame.index)} filas ${frame.badRows.join("/")}`)
          .join(", "),
      ),
      check(
        "índices dentro de la paleta",
        unknown.length === 0,
        unknown
          .map((frame) => `frame ${String(frame.index)}: ${frame.unknownChars.join("")}`)
          .join(", "),
      ),
      check(
        "ningún frame vacío",
        empty.length === 0,
        `frame(s) totalmente transparentes: ${empty.map((frame) => frame.index).join(", ")}`,
      ),
      check(
        "cobertura mínima de píxeles",
        thin.length === 0,
        thin
          .map(
            (frame) =>
              `frame ${String(frame.index)}: ${(100 * (frame.opaque / area)).toFixed(1)}% < ` +
              `${(100 * minRatio).toFixed(1)}%`,
          )
          .join(", "),
      ),
    ];

    return scoreChecks(checks);
  },
};
