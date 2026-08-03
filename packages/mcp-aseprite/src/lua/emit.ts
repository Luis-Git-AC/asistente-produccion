import type { SpriteSpec, SpriteTag, TagDirection } from "@asistente/shared";

/**
 * Generador de Lua desde un `SpriteSpec`. Puro y determinista: mismo spec, mismo script.
 *
 * Regla de oro del protocolo: **una tarea = un script = una llamada MCP = una `app.transaction`**.
 * El cuello de botella no es Aseprite, es el round-trip del WebSocket. Un sprite de 32x32 con una
 * llamada por píxel son ~1000 round-trips; aquí es 1.
 *
 * Trampas de la API de Aseprite que este emisor respeta (documentadas en la skill):
 *  - `frame.duration` está en SEGUNDOS; el spec lo trae en milisegundos.
 *  - Los índices de `Image` son 0-based; los de `spr.frames`/`spr.layers` y las tablas Lua, 1-based.
 *    Los rangos de tags del spec son 0-based y aquí se convierten.
 *  - `AniDir.PING_PONG` lleva guion bajo.
 *  - En `ColorMode.RGB`, `drawPixel` espera un ENTERO de píxel (0xRRGGBBAA), no un `Color`.
 *  - Ni `app.alert`, ni `Dialog`, ni `app.command` sin `ui=false`: cuelgan el hilo de UI y con él
 *    el WebSocket del connector.
 */

/** Carácter reservado a transparencia en el pixel-map. */
const TRANSPARENT = ".";

/**
 * Elimina caracteres de control no imprimibles, preservando tabulador, salto de línea y retorno
 * de carro (que sí se escapan luego). Se filtra por código de carácter en vez de con una
 * expresión regular porque incrustar caracteres de control literales en un literal regex es
 * justo lo que la regla `no-control-regex` marca como propenso a errores.
 */
function stripUnprintableChars(value: string): string {
  const TAB = 0x09;
  const LF = 0x0a;
  const CR = 0x0d;
  const DEL = 0x7f;

  let out = "";
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    const isPreservedWhitespace = code === TAB || code === LF || code === CR;
    if (isPreservedWhitespace || (code > 0x1f && code !== DEL)) out += char;
  }
  return out;
}

/**
 * Escapa una cadena para incrustarla en un literal Lua entre comillas dobles.
 * Un salto de línea crudo dentro de `"..."` es un error de sintaxis en Lua, así que se escapa
 * en vez de eliminarse: preservar el dato es mejor que mutilarlo en silencio.
 */
export function luaString(value: string): string {
  const escaped = stripUnprintableChars(value)
    .replace(/\\/gu, "\\\\")
    .replace(/"/gu, '\\"')
    .replace(/\n/gu, "\\n")
    .replace(/\r/gu, "\\r")
    .replace(/\t/gu, "\\t");
  return `"${escaped}"`;
}

/**
 * `#RRGGBB` -> expresión Lua `Color{ r = .., g = .., b = .., a = 255 }`.
 *
 * **No se emite un entero hexadecimal.** Aseprite empaqueta RGBA en little-endian
 * (`0xAABBGGRR`), así que un literal `0xRRGGBBAA` entra con los canales R y B cruzados: los
 * colores salen parecidos en luminosidad pero con el tono equivocado, que es justo el tipo de
 * fallo que ningún test de sintaxis detecta. Construir el color por componentes es independiente
 * del orden de bytes y es lo que hace la implementación de referencia verificada contra
 * Aseprite 1.3.18.1. `Image:drawPixel` acepta el objeto `Color` igual que el entero.
 */
export function hexToLuaColor(hex: string): string {
  const normalized = hex.replace("#", "");
  const r = Number.parseInt(normalized.slice(0, 2), 16);
  const g = Number.parseInt(normalized.slice(2, 4), 16);
  const b = Number.parseInt(normalized.slice(4, 6), 16);
  return `Color{ r = ${String(r)}, g = ${String(g)}, b = ${String(b)}, a = 255 }`;
}

const ANI_DIR_BY_DIRECTION: Record<TagDirection, string> = {
  forward: "AniDir.FORWARD",
  reverse: "AniDir.REVERSE",
  // Guion bajo: `AniDir.PINGPONG` no existe y rompe el script en runtime.
  pingpong: "AniDir.PING_PONG",
};

export function aniDirFor(direction: TagDirection): string {
  return ANI_DIR_BY_DIRECTION[direction];
}

/** ms -> segundos, que es lo que espera `frame.duration`. */
export function durationToSeconds(durationMs: number): number {
  return Math.round(durationMs) / 1000;
}

/** Convierte un tag del spec (0-based) al rango 1-based de Aseprite. */
function tagToLua(tag: SpriteTag): string {
  return `{ name = ${luaString(tag.name)}, from = ${String(tag.from + 1)}, to = ${String(
    tag.to + 1,
  )}, dir = ${aniDirFor(tag.direction)} }`;
}

export interface EmitGenerateSpriteOptions {
  /** Ruta absoluta del `.aseprite` a guardar. Debe venir ya saneada por `output-paths.ts`. */
  asepritePath: string;
  /** Ruta absoluta del PNG del spritesheet. */
  spritesheetPath: string;
  /** Ruta absoluta del JSON de metadatos. */
  jsonPath: string;
  /** Nombre de la capa principal. */
  layerName?: string;
}

/**
 * Emite el script completo que materializa un `SpriteSpec`: sprite, paleta, frames, tags,
 * guardado y export del spritesheet. Todo en UN script y UNA transaction.
 */
export function emitGenerateSpriteLua(
  spec: SpriteSpec,
  options: EmitGenerateSpriteOptions,
): string {
  const layerName = options.layerName ?? spec.name;

  const paletteEntries = spec.palette
    .map((entry) => `  [${luaString(entry.token)}] = ${hexToLuaColor(entry.hex)},`)
    .join("\n");

  const paletteOrder = spec.palette.map((entry) => hexToLuaColor(entry.hex)).join(", ");

  const frames = spec.frames
    .map((frame) => {
      const rows = frame.pixels.map((row) => `    ${luaString(row)},`).join("\n");
      return `  {\n${rows}\n  },`;
    })
    .join("\n");

  const durations = spec.frames
    .map((frame) => durationToSeconds(frame.durationMs).toFixed(3))
    .join(", ");

  const tags = spec.tags.map((tag) => `  ${tagToLua(tag)},`).join("\n");

  return `-- Generado por @asistente/mcp-aseprite — no editar a mano.
-- spec: ${spec.name} (${spec.kind}) schemaVersion=${spec.schemaVersion}
local PAL = {
${paletteEntries}
}

local PAL_ORDER = { ${paletteOrder} }

local FRAMES = {
${frames}
}

local DURS = { ${durations} }

local TAGS = {
${tags}
}

local W, H = ${String(spec.canvas.width)}, ${String(spec.canvas.height)}
local TRANSPARENT = ${luaString(TRANSPARENT)}

-- Decodifica un pixel-map compacto a un Image. Índices de Image 0-based, de Lua 1-based.
local function mapToImage(MAP)
  local img = Image(W, H, ColorMode.RGB)
  img:clear(0)
  for y = 1, #MAP do
    local row = MAP[y]
    for x = 1, #row do
      local ch = row:sub(x, x)
      if ch ~= TRANSPARENT then
        local col = PAL[ch]
        if col then img:drawPixel(x - 1, y - 1, col) end
      end
    end
  end
  return img
end

local spr = Sprite(W, H, ColorMode.RGB)
spr.filename = ${luaString(options.asepritePath)}

app.transaction(${luaString(`asistente: ${spec.name}`)}, function()
  local pal = Palette(#PAL_ORDER)
  for i, c in ipairs(PAL_ORDER) do
    -- PAL_ORDER ya contiene objetos Color construidos por componentes: nada de reempaquetar.
    pal:setColor(i - 1, c)
  end
  spr:setPalette(pal)

  spr.layers[1].name = ${luaString(layerName)}

  for i = 1, #FRAMES do
    local f = (i == 1) and spr.frames[1] or spr:newFrame()
    spr:newCel(spr.layers[1], f, mapToImage(FRAMES[i]), Point(0, 0))
    f.duration = DURS[i]
  end

  for _, t in ipairs(TAGS) do
    local tag = spr:newTag(t.from, t.to)
    tag.name = t.name
    tag.aniDir = t.dir
  end
end)

spr:saveAs(${luaString(options.asepritePath)})

app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = SpriteSheetType.ROWS,
  textureFilename = ${luaString(options.spritesheetPath)},
  dataFilename = ${luaString(options.jsonPath)},
  dataFormat = SpriteSheetDataFormat.JSON_ARRAY,
  trim = false,
  borderPadding = ${String(spec.export.padding)},
  shapePadding = ${String(spec.export.padding)},
  innerPadding = 0,
  extrude = false,
  splitLayers = false,
  splitTags = false,
  listLayers = false,
  listTags = true,
  listSlices = false,
  openGenerated = false,
}

app.refresh()
return "OK frames=" .. #spr.frames .. " tags=" .. #spr.tags .. " palette=" .. #PAL_ORDER
`;
}

export interface EmitExportSpritesheetOptions {
  asepritePath: string;
  spritesheetPath: string;
  jsonPath: string;
  layout: SpriteSpec["export"]["spritesheetLayout"];
  padding: number;
  generateJson: boolean;
}

const SHEET_TYPE_BY_LAYOUT: Record<SpriteSpec["export"]["spritesheetLayout"], string> = {
  rows: "SpriteSheetType.ROWS",
  columns: "SpriteSheetType.COLUMNS",
  packed: "SpriteSheetType.PACKED",
};

/**
 * Emite el script de reexport de un `.aseprite` ya existente. Abre, exporta y cierra sin dejar
 * el documento colgado en la UI.
 */
export function emitExportSpritesheetLua(options: EmitExportSpritesheetOptions): string {
  const dataLine = options.generateJson
    ? `  dataFilename = ${luaString(options.jsonPath)},\n  dataFormat = SpriteSheetDataFormat.JSON_ARRAY,\n`
    : "";

  return `-- Generado por @asistente/mcp-aseprite — no editar a mano.
local spr = app.open(${luaString(options.asepritePath)})
if not spr then
  return "ERROR: no se pudo abrir " .. ${luaString(options.asepritePath)}
end

app.command.ExportSpriteSheet{
  ui = false,
  askOverwrite = false,
  type = ${SHEET_TYPE_BY_LAYOUT[options.layout]},
  textureFilename = ${luaString(options.spritesheetPath)},
${dataLine}  trim = false,
  borderPadding = ${String(options.padding)},
  shapePadding = ${String(options.padding)},
  innerPadding = 0,
  extrude = false,
  splitLayers = false,
  splitTags = false,
  listLayers = false,
  listTags = true,
  listSlices = false,
  openGenerated = false,
}

local frameCount = #spr.frames
spr:close()
app.refresh()
return "OK frames=" .. frameCount
`;
}

/** Script de diagnóstico barato: un resumen en una sola string, sin volcar píxeles. */
export function emitDescribeCapabilitiesLua(): string {
  return `local t = {}
t[#t+1] = "version=" .. tostring(app.version)
t[#t+1] = "apiVersion=" .. tostring(app.apiVersion)
local spr = app.sprite
if spr then
  t[#t+1] = string.format("activeSprite=%dx%d frames=%d", spr.width, spr.height, #spr.frames)
else
  t[#t+1] = "activeSprite=none"
end
return table.concat(t, " | ")
`;
}

/**
 * Avisos de producción que el schema no puede expresar. No bloquean la generación: se devuelven
 * al llamante para que decida.
 */
export function collectWarnings(spec: SpriteSpec): string[] {
  const warnings: string[] = [];

  if (spec.frames.length > 1) {
    const durations = new Set(spec.frames.map((frame) => frame.durationMs));
    if (durations.size === 1) {
      warnings.push(
        "Todos los frames duran lo mismo: la animación tenderá a leerse sin peso. " +
          "Considera duraciones desiguales en los frames de impacto y de reposo.",
      );
    }
  }

  const framesInTags = new Set<number>();
  for (const tag of spec.tags) {
    for (let i = tag.from; i <= tag.to; i += 1) framesInTags.add(i);
  }
  const orphanFrames = spec.frames.filter((frame) => !framesInTags.has(frame.index));
  if (spec.tags.length > 0 && orphanFrames.length > 0) {
    warnings.push(
      `${String(orphanFrames.length)} frame(s) no pertenecen a ningún tag: no serán alcanzables ` +
        "desde el Animator de Unity.",
    );
  }

  if (spec.palette.length > 16) {
    warnings.push("La paleta supera las 16 entradas: revisa que sea intencionado.");
  }

  const isSmall = spec.canvas.width < 32 || spec.canvas.height < 32;
  if (isSmall && spec.shapeLanguage.valueStructure > 4) {
    warnings.push(
      `Canvas ${String(spec.canvas.width)}x${String(spec.canvas.height)} con ` +
        `${String(spec.shapeLanguage.valueStructure)} valores tonales: a este tamaño tiende a ` +
        "aplanar la lectura. 3 valores + 1 acento suele leerse mejor.",
    );
  }

  return warnings;
}
