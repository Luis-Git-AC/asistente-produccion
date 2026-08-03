import { z } from "zod";

/**
 * Contrato de dominio entre el modelo, el servidor y el MCP. Todo campo que participa en el
 * JSON Schema enviado a `output_config.format` usa únicamente validadores "estructurales"
 * (type, enum, const, forma de objeto/array): nada de `.int()`, `.min()`, `.max()`, `.length()`
 * ni `.regex()` en esos campos, porque Zod v4 los traduce a `minimum`/`maximum`/`minLength`/
 * `maxLength`/`pattern` en el JSON Schema compilado, y esas keywords rompen los structured
 * outputs de la API (ver `assertStructuredOutputCompatible` en `json-schema.ts`). Toda esa
 * validación numérica/de formato vive en el `superRefine` de más abajo.
 */

export const SPRITE_SPEC_SCHEMA_VERSION = "1.0.0" as const;

export const SPRITE_KINDS = ["sprite", "tileset"] as const;
export type SpriteKind = (typeof SPRITE_KINDS)[number];

export const PALETTE_ROLES = ["base", "shadow", "highlight", "outline", "accent"] as const;
export type PaletteRole = (typeof PALETTE_ROLES)[number];

export const DOMINANT_SHAPES = ["circle", "square", "triangle", "mixed"] as const;
export type DominantShape = (typeof DOMINANT_SHAPES)[number];

export const TAG_DIRECTIONS = ["forward", "reverse", "pingpong"] as const;
export type TagDirection = (typeof TAG_DIRECTIONS)[number];

export const SPRITESHEET_LAYOUTS = ["rows", "columns", "packed"] as const;
export type SpritesheetLayout = (typeof SPRITESHEET_LAYOUTS)[number];

/** Carácter reservado para "sin píxel" en un pixel-map. Nunca puede ser un token de paleta. */
export const TRANSPARENT_TOKEN = ".";

export const MAX_PALETTE_ENTRIES = 16;
export const MIN_VALUE_STRUCTURE = 2;
export const MAX_VALUE_STRUCTURE = 5;
export const MIN_FRAME_DURATION_MS = 1;
export const MAX_FRAME_DURATION_MS = 5000;
export const MAX_EXPORT_PADDING = 16;

const HEX_COLOR_RE = /^#[0-9A-Fa-f]{6}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

function isInt(value: number): boolean {
  return Number.isInteger(value);
}

function isPowerOfTwo(value: number): boolean {
  return value > 0 && (value & (value - 1)) === 0;
}

function isValidCanvasDimension(value: number): boolean {
  return isInt(value) && value > 0 && (isPowerOfTwo(value) || value % 8 === 0);
}

const PaletteEntrySchema = z.object({
  /** Carácter único usado en las filas de `frames[].pixels` para referenciar este color. */
  token: z.string(),
  hex: z.string(),
  role: z.enum(PALETTE_ROLES),
});
export type PaletteEntry = z.infer<typeof PaletteEntrySchema>;

const CanvasSchema = z.object({
  width: z.number(),
  height: z.number(),
});
export type Canvas = z.infer<typeof CanvasSchema>;

const ShapeLanguageSchema = z.object({
  dominantShape: z.enum(DOMINANT_SHAPES),
  silhouette: z.string(),
  readabilityNotes: z.string(),
  /** Número de valores tonales (sombra/medio/luz + acento opcional). Ver skill drawing-2d. */
  valueStructure: z.number(),
});
export type ShapeLanguage = z.infer<typeof ShapeLanguageSchema>;

const FrameSchema = z.object({
  index: z.number(),
  durationMs: z.number(),
  /** Pixel-map compacto: una fila por elemento, un carácter por píxel. `.` = transparente. */
  pixels: z.array(z.string()),
});
export type SpriteFrame = z.infer<typeof FrameSchema>;

const TagSchema = z.object({
  name: z.string(),
  from: z.number(),
  to: z.number(),
  direction: z.enum(TAG_DIRECTIONS),
});
export type SpriteTag = z.infer<typeof TagSchema>;

const ExportSchema = z.object({
  spritesheetLayout: z.enum(SPRITESHEET_LAYOUTS),
  padding: z.number(),
  generateJson: z.boolean(),
});
export type SpriteExport = z.infer<typeof ExportSchema>;

const BaseSpriteSpecSchema = z.object({
  schemaVersion: z.literal(SPRITE_SPEC_SCHEMA_VERSION),
  kind: z.enum(SPRITE_KINDS),
  name: z.string(),
  canvas: CanvasSchema,
  palette: z.array(PaletteEntrySchema),
  shapeLanguage: ShapeLanguageSchema,
  frames: z.array(FrameSchema),
  tags: z.array(TagSchema),
  export: ExportSchema,
});

export const SpriteSpecSchema = BaseSpriteSpecSchema.superRefine((spec, ctx) => {
  if (!SLUG_RE.test(spec.name)) {
    ctx.addIssue({
      code: "custom",
      path: ["name"],
      message: "name debe ser un slug: minúsculas, dígitos y guiones, sin guiones al borde.",
    });
  }

  if (!isValidCanvasDimension(spec.canvas.width)) {
    ctx.addIssue({
      code: "custom",
      path: ["canvas", "width"],
      message: "canvas.width debe ser un entero positivo, potencia de 2 o múltiplo de 8.",
    });
  }
  if (!isValidCanvasDimension(spec.canvas.height)) {
    ctx.addIssue({
      code: "custom",
      path: ["canvas", "height"],
      message: "canvas.height debe ser un entero positivo, potencia de 2 o múltiplo de 8.",
    });
  }

  if (spec.palette.length < 1 || spec.palette.length > MAX_PALETTE_ENTRIES) {
    ctx.addIssue({
      code: "custom",
      path: ["palette"],
      message: `palette debe tener entre 1 y ${MAX_PALETTE_ENTRIES} entradas.`,
    });
  }
  const seenTokens = new Set<string>();
  spec.palette.forEach((entry, i) => {
    if (!HEX_COLOR_RE.test(entry.hex)) {
      ctx.addIssue({
        code: "custom",
        path: ["palette", i, "hex"],
        message: `hex inválido: "${entry.hex}", se espera formato #RRGGBB.`,
      });
    }
    if (entry.token.length !== 1 || entry.token === TRANSPARENT_TOKEN) {
      ctx.addIssue({
        code: "custom",
        path: ["palette", i, "token"],
        message: `token de paleta inválido: "${entry.token}" (debe ser 1 carácter, distinto de "${TRANSPARENT_TOKEN}").`,
      });
    }
    if (seenTokens.has(entry.token)) {
      ctx.addIssue({
        code: "custom",
        path: ["palette", i, "token"],
        message: `token de paleta duplicado: "${entry.token}".`,
      });
    }
    seenTokens.add(entry.token);
  });

  if (
    !isInt(spec.shapeLanguage.valueStructure) ||
    spec.shapeLanguage.valueStructure < MIN_VALUE_STRUCTURE ||
    spec.shapeLanguage.valueStructure > MAX_VALUE_STRUCTURE
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["shapeLanguage", "valueStructure"],
      message: `valueStructure debe ser un entero entre ${MIN_VALUE_STRUCTURE} y ${MAX_VALUE_STRUCTURE}.`,
    });
  }
  if (spec.shapeLanguage.silhouette.trim().length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["shapeLanguage", "silhouette"],
      message: "silhouette no puede estar vacío.",
    });
  }
  if (spec.shapeLanguage.readabilityNotes.trim().length === 0) {
    ctx.addIssue({
      code: "custom",
      path: ["shapeLanguage", "readabilityNotes"],
      message: "readabilityNotes no puede estar vacío.",
    });
  }

  if (spec.frames.length < 1) {
    ctx.addIssue({
      code: "custom",
      path: ["frames"],
      message: "frames debe tener al menos un elemento.",
    });
  }

  spec.frames.forEach((frame, i) => {
    if (frame.index !== i) {
      ctx.addIssue({
        code: "custom",
        path: ["frames", i, "index"],
        message: `index debe coincidir con la posición en el array (esperado ${i}, recibido ${frame.index}).`,
      });
    }
    if (
      !isInt(frame.durationMs) ||
      frame.durationMs < MIN_FRAME_DURATION_MS ||
      frame.durationMs > MAX_FRAME_DURATION_MS
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["frames", i, "durationMs"],
        message: `durationMs debe ser un entero entre ${MIN_FRAME_DURATION_MS} y ${MAX_FRAME_DURATION_MS}.`,
      });
    }
    if (frame.pixels.length !== spec.canvas.height) {
      ctx.addIssue({
        code: "custom",
        path: ["frames", i, "pixels"],
        message: `frame ${i}: número de filas (${frame.pixels.length}) no coincide con canvas.height (${spec.canvas.height}).`,
      });
    }
    frame.pixels.forEach((row, rowIndex) => {
      if (row.length !== spec.canvas.width) {
        ctx.addIssue({
          code: "custom",
          path: ["frames", i, "pixels", rowIndex],
          message: `frame ${i} fila ${rowIndex}: longitud (${row.length}) no coincide con canvas.width (${spec.canvas.width}).`,
        });
        return;
      }
      for (const char of row) {
        if (char !== TRANSPARENT_TOKEN && !seenTokens.has(char)) {
          ctx.addIssue({
            code: "custom",
            path: ["frames", i, "pixels", rowIndex],
            message: `frame ${i} fila ${rowIndex}: índice de paleta inexistente "${char}".`,
          });
          break;
        }
      }
    });
  });

  const seenTagNames = new Set<string>();
  spec.tags.forEach((tag, i) => {
    if (tag.name.trim().length === 0) {
      ctx.addIssue({
        code: "custom",
        path: ["tags", i, "name"],
        message: "el nombre del tag no puede estar vacío.",
      });
    }
    if (seenTagNames.has(tag.name)) {
      ctx.addIssue({
        code: "custom",
        path: ["tags", i, "name"],
        message: `nombre de tag duplicado: "${tag.name}".`,
      });
    }
    seenTagNames.add(tag.name);

    const maxFrameIndex = spec.frames.length - 1;
    if (
      !isInt(tag.from) ||
      !isInt(tag.to) ||
      tag.from < 0 ||
      tag.to > maxFrameIndex ||
      tag.from > tag.to
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["tags", i],
        message: `rango de tag "${tag.name}" [${tag.from}, ${tag.to}] fuera de rango de frames (0..${maxFrameIndex}).`,
      });
    }
  });

  for (let i = 0; i < spec.tags.length; i += 1) {
    for (let j = i + 1; j < spec.tags.length; j += 1) {
      const a = spec.tags[i]!;
      const b = spec.tags[j]!;
      const overlaps = a.from <= b.to && b.from <= a.to;
      if (overlaps) {
        ctx.addIssue({
          code: "custom",
          path: ["tags", j],
          message: `el tag "${b.name}" [${b.from}, ${b.to}] se solapa de forma ambigua con "${a.name}" [${a.from}, ${a.to}].`,
        });
      }
    }
  }

  if (
    !isInt(spec.export.padding) ||
    spec.export.padding < 0 ||
    spec.export.padding > MAX_EXPORT_PADDING
  ) {
    ctx.addIssue({
      code: "custom",
      path: ["export", "padding"],
      message: `export.padding debe ser un entero entre 0 y ${MAX_EXPORT_PADDING}.`,
    });
  }
});

export type SpriteSpec = z.infer<typeof BaseSpriteSpecSchema>;

/**
 * Fixture mínimo y válido: icono de gema 8×8, un frame, un tag. Reutilizable por fases
 * posteriores (cliente LLM, MCP, evals) como caso de referencia conocido-bueno.
 */
export const EXAMPLE_SPRITE_SPEC: SpriteSpec = {
  schemaVersion: SPRITE_SPEC_SCHEMA_VERSION,
  kind: "sprite",
  name: "gem-icon",
  canvas: { width: 8, height: 8 },
  palette: [
    { token: "o", hex: "#12211f", role: "outline" },
    { token: "b", hex: "#3f9d90", role: "base" },
    { token: "s", hex: "#1f5750", role: "shadow" },
    { token: "h", hex: "#bdf3ea", role: "highlight" },
    { token: "a", hex: "#ffcd75", role: "accent" },
  ],
  shapeLanguage: {
    dominantShape: "mixed",
    silhouette: "gema romboidal simétrica, se lee como silueta sólida a tamaño real",
    readabilityNotes: "contorno continuo, sin ruido de borde; pensado para icono a 8x8",
    valueStructure: 3,
  },
  frames: [
    {
      index: 0,
      durationMs: 100,
      pixels: [
        "...oo...",
        "..ohho..",
        ".ohbbho.",
        "ohbbbbho",
        "ohbbbbho",
        ".ohbbho.",
        "..ohho..",
        "...oo...",
      ],
    },
  ],
  tags: [{ name: "idle", from: 0, to: 0, direction: "forward" }],
  export: { spritesheetLayout: "rows", padding: 0, generateJson: true },
};
