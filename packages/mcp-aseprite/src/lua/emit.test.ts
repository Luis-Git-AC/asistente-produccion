import { EXAMPLE_SPRITE_SPEC, type SpriteSpec } from "@asistente/shared";
import { describe, expect, it } from "vitest";
import {
  aniDirFor,
  collectWarnings,
  durationToSeconds,
  emitDescribeCapabilitiesLua,
  emitExportSpritesheetLua,
  emitGenerateSpriteLua,
  hexToLuaColor,
  luaString,
} from "./emit.js";

const PATHS = {
  asepritePath: "/out/gem-icon.aseprite",
  spritesheetPath: "/out/gem-icon.png",
  jsonPath: "/out/gem-icon.json",
};

function clone(spec: SpriteSpec): SpriteSpec {
  return JSON.parse(JSON.stringify(spec)) as SpriteSpec;
}

/** Fixture de 8 frames, para el test de "un spec grande sigue siendo un solo mensaje". */
function eightFrameSpec(): SpriteSpec {
  const spec = clone(EXAMPLE_SPRITE_SPEC);
  const basePixels = spec.frames[0]!.pixels;
  spec.frames = Array.from({ length: 8 }, (_, index) => ({
    index,
    durationMs: 80 + index,
    pixels: basePixels,
  }));
  spec.tags = [{ name: "idle", from: 0, to: 7, direction: "pingpong" }];
  return spec;
}

describe("luaString", () => {
  it("escapa comillas y barras invertidas", () => {
    expect(luaString('a"b\\c')).toBe('"a\\"b\\\\c"');
  });

  it("escapa saltos de línea", () => {
    expect(luaString("a\nb")).toBe('"a\\nb"');
  });

  it("neutraliza un intento de romper el literal e inyectar Lua", () => {
    // El `name` lo genera el modelo; aunque Zod lo valide como slug, el emisor no confía.
    const emitted = luaString('x" ; os.execute("rm -rf /") --');
    expect(emitted).not.toMatch(/[^\\]"\s*;/u);
    expect(emitted.startsWith('"')).toBe(true);
    expect(emitted.endsWith('"')).toBe(true);
  });
});

describe("hexToLuaColor", () => {
  it("convierte #RRGGBB a 0xRRGGBBff", () => {
    expect(hexToLuaColor("#1A2B3C")).toBe("0x1a2b3cff");
  });
});

describe("aniDirFor", () => {
  it("mapea pingpong a AniDir.PING_PONG, con guion bajo", () => {
    // `AniDir.PINGPONG` no existe: rompería el script en runtime, no al emitirlo.
    expect(aniDirFor("pingpong")).toBe("AniDir.PING_PONG");
  });

  it("mapea forward y reverse", () => {
    expect(aniDirFor("forward")).toBe("AniDir.FORWARD");
    expect(aniDirFor("reverse")).toBe("AniDir.REVERSE");
  });
});

describe("durationToSeconds", () => {
  it("convierte milisegundos a segundos", () => {
    // frame.duration en Aseprite está en segundos; el spec lo declara en ms.
    expect(durationToSeconds(100)).toBe(0.1);
    expect(durationToSeconds(1000)).toBe(1);
    expect(durationToSeconds(80)).toBe(0.08);
  });
});

describe("emitGenerateSpriteLua", () => {
  it("es determinista: el mismo spec produce el mismo script", () => {
    const a = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    const b = emitGenerateSpriteLua(clone(EXAMPLE_SPRITE_SPEC), PATHS);
    expect(a).toBe(b);
  });

  it("coincide con el snapshot", () => {
    expect(emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS)).toMatchSnapshot();
  });

  it("contiene exactamente una app.transaction", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    expect(lua.match(/app\.transaction\(/gu)).toHaveLength(1);
  });

  it("un spec de 8 frames sigue teniendo exactamente una app.transaction", () => {
    const lua = emitGenerateSpriteLua(eightFrameSpec(), PATHS);
    expect(lua.match(/app\.transaction\(/gu)).toHaveLength(1);
  });

  it("llama a app.refresh una sola vez y fuera del bucle", () => {
    const lua = emitGenerateSpriteLua(eightFrameSpec(), PATHS);
    expect(lua.match(/app\.refresh\(\)/gu)).toHaveLength(1);
    // El refresh va después de cerrar la transaction, nunca dentro del for de frames.
    expect(lua.indexOf("app.refresh()")).toBeGreaterThan(lua.indexOf("end)"));
  });

  it("no usa app.useTool ni una llamada por píxel", () => {
    const lua = emitGenerateSpriteLua(eightFrameSpec(), PATHS);
    expect(lua).not.toContain("app.useTool");
    // El pixel-map viaja como filas de texto; sólo hay un drawPixel, dentro del decodificador.
    expect(lua.match(/drawPixel/gu)).toHaveLength(1);
  });

  it("no abre nada que bloquee la interfaz de Aseprite", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    expect(lua).not.toContain("app.alert");
    expect(lua).not.toContain("Dialog");
    // Todo app.command lleva ui = false.
    const commands = lua.match(/app\.command\.\w+\{[^}]*\}/gsu) ?? [];
    expect(commands.length).toBeGreaterThan(0);
    for (const command of commands) expect(command).toMatch(/ui\s*=\s*false/u);
  });

  it("construye la paleta de una vez, antes de los frames", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    expect(lua.match(/spr:setPalette\(/gu)).toHaveLength(1);
    expect(lua.indexOf("spr:setPalette(")).toBeLessThan(lua.indexOf("spr:newCel("));
  });

  it("convierte los rangos de tags de 0-based a 1-based", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames = eightFrameSpec().frames;
    spec.tags = [{ name: "walk", from: 2, to: 5, direction: "forward" }];

    const lua = emitGenerateSpriteLua(spec, PATHS);

    expect(lua).toContain('{ name = "walk", from = 3, to = 6, dir = AniDir.FORWARD }');
  });

  it("emite las duraciones en segundos", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    // El fixture trae 100 ms.
    expect(lua).toContain("local DURS = { 0.100 }");
  });

  it("emite el pixel-map como filas de texto, no como coordenadas", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    for (const row of EXAMPLE_SPRITE_SPEC.frames[0]!.pixels) {
      expect(lua).toContain(`"${row}"`);
    }
  });

  it("incrusta las rutas de salida ya resueltas", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    expect(lua).toContain(`spr:saveAs("${PATHS.asepritePath}")`);
    expect(lua).toContain(`textureFilename = "${PATHS.spritesheetPath}"`);
    expect(lua).toContain(`dataFilename = "${PATHS.jsonPath}"`);
  });

  it("exporta con grid uniforme, sin trim ni extrude (Grid By Cell Size en Unity)", () => {
    const lua = emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS);
    expect(lua).toContain("type = SpriteSheetType.ROWS");
    expect(lua).toContain("trim = false");
    expect(lua).toContain("extrude = false");
    expect(lua).toContain("listTags = true");
    expect(lua).toContain("dataFormat = SpriteSheetDataFormat.JSON_ARRAY");
  });
});

describe("emitExportSpritesheetLua", () => {
  it("mapea el layout al SpriteSheetType correspondiente", () => {
    const lua = emitExportSpritesheetLua({
      asepritePath: "/out/a.aseprite",
      spritesheetPath: "/out/a.png",
      jsonPath: "/out/a.json",
      layout: "columns",
      padding: 2,
      generateJson: true,
    });
    expect(lua).toContain("type = SpriteSheetType.COLUMNS");
    expect(lua).toContain("borderPadding = 2");
  });

  it("omite el JSON cuando no se pide", () => {
    const lua = emitExportSpritesheetLua({
      asepritePath: "/out/a.aseprite",
      spritesheetPath: "/out/a.png",
      jsonPath: "/out/a.json",
      layout: "rows",
      padding: 0,
      generateJson: false,
    });
    expect(lua).not.toContain("dataFilename");
  });

  it("cierra el documento para no dejarlo colgado en la UI", () => {
    const lua = emitExportSpritesheetLua({
      asepritePath: "/out/a.aseprite",
      spritesheetPath: "/out/a.png",
      jsonPath: "/out/a.json",
      layout: "rows",
      padding: 0,
      generateJson: true,
    });
    expect(lua).toContain("spr:close()");
  });

  it("devuelve ERROR como string en vez de reventar si no puede abrir el fichero", () => {
    const lua = emitExportSpritesheetLua({
      asepritePath: "/out/a.aseprite",
      spritesheetPath: "/out/a.png",
      jsonPath: "/out/a.json",
      layout: "rows",
      padding: 0,
      generateJson: true,
    });
    expect(lua).toMatch(/return "ERROR: no se pudo abrir "/u);
  });
});

describe("emitDescribeCapabilitiesLua", () => {
  it("devuelve un resumen en una sola string, sin volcar píxeles", () => {
    const lua = emitDescribeCapabilitiesLua();
    expect(lua).toContain("app.version");
    expect(lua).toContain("table.concat");
    expect(lua).not.toContain("pixels()");
  });

  it("tolera que no haya sprite activo", () => {
    expect(emitDescribeCapabilitiesLua()).toContain("activeSprite=none");
  });
});

describe("collectWarnings", () => {
  it("no avisa de nada en el fixture de referencia", () => {
    expect(collectWarnings(EXAMPLE_SPRITE_SPEC)).toEqual([]);
  });

  it("avisa si todos los frames duran lo mismo", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames = [0, 1, 2].map((index) => ({
      index,
      durationMs: 100,
      pixels: spec.frames[0]!.pixels,
    }));
    spec.tags = [{ name: "idle", from: 0, to: 2, direction: "forward" }];

    expect(collectWarnings(spec).join(" ")).toMatch(/sin peso/u);
  });

  it("avisa de frames huérfanos fuera de todo tag", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames = [0, 1, 2].map((index) => ({
      index,
      durationMs: 100 + index,
      pixels: spec.frames[0]!.pixels,
    }));
    spec.tags = [{ name: "idle", from: 0, to: 0, direction: "forward" }];

    expect(collectWarnings(spec).join(" ")).toMatch(/no pertenecen a ningún tag/u);
  });

  it("avisa de exceso de valores tonales en un canvas pequeño", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.shapeLanguage.valueStructure = 5;

    expect(collectWarnings(spec).join(" ")).toMatch(/aplanar la lectura/u);
  });
});
