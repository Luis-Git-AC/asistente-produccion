import { EXAMPLE_SPRITE_SPEC, type SpriteSpec } from "@asistente/shared";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import luaparse from "luaparse";
import { describe, expect, it } from "vitest";
import {
  emitDescribeCapabilitiesLua,
  emitExportSpritesheetLua,
  emitGenerateSpriteLua,
} from "./emit.js";

/**
 * El Lua emitido se ejecuta dentro de Aseprite, donde un error de sintaxis sólo se descubre en
 * runtime y llega de vuelta como una cadena por el WebSocket. Parsearlo aquí convierte ese fallo
 * tardío y caro de diagnosticar en un test que falla en CI, sin necesitar Aseprite.
 */

function expectParses(lua: string): void {
  expect(() => {
    luaparse.parse(lua, { luaVersion: "5.3" });
  }).not.toThrow();
}

function clone(spec: SpriteSpec): SpriteSpec {
  return JSON.parse(JSON.stringify(spec)) as SpriteSpec;
}

const PATHS = {
  asepritePath: "/out/gem-icon.aseprite",
  spritesheetPath: "/out/gem-icon.png",
  jsonPath: "/out/gem-icon.json",
};

describe("sintaxis del Lua emitido", () => {
  it("connector.lua es Lua válido", () => {
    const connector = fileURLToPath(new URL("../../../../aseprite/connector.lua", import.meta.url));
    expectParses(readFileSync(connector, "utf8"));
  });

  it("el script de generate_sprite parsea", () => {
    expectParses(emitGenerateSpriteLua(EXAMPLE_SPRITE_SPEC, PATHS));
  });

  it("parsea con varios frames y los tres AniDir", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames = Array.from({ length: 6 }, (_, index) => ({
      index,
      durationMs: 60 + index * 10,
      pixels: spec.frames[0]!.pixels,
    }));
    spec.tags = [
      { name: "idle", from: 0, to: 1, direction: "forward" },
      { name: "walk", from: 2, to: 3, direction: "reverse" },
      { name: "hit", from: 4, to: 5, direction: "pingpong" },
    ];

    expectParses(emitGenerateSpriteLua(spec, PATHS));
  });

  it("parsea con un spec sin tags", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.tags = [];
    expectParses(emitGenerateSpriteLua(spec, PATHS));
  });

  it("sigue parseando con un nombre hostil que intenta cerrar el literal", () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    (spec as { name: string }).name = 'x" ; os.execute("calc") --';

    const lua = emitGenerateSpriteLua(spec, PATHS);

    // Si el escapado fallara, el `;` quedaría fuera del literal y esto sería Lua válido
    // pero con código inyectado; parsea, y además el payload no aparece como código.
    expectParses(lua);
    expect(lua).not.toMatch(/^\s*os\.execute/mu);
  });

  it("los scripts de export parsean, con y sin JSON", () => {
    for (const generateJson of [true, false]) {
      expectParses(
        emitExportSpritesheetLua({
          asepritePath: "/out/a.aseprite",
          spritesheetPath: "/out/a.png",
          jsonPath: "/out/a.json",
          layout: "rows",
          padding: 0,
          generateJson,
        }),
      );
    }
  });

  it("el script de describe_capabilities parsea", () => {
    expectParses(emitDescribeCapabilitiesLua());
  });
});
