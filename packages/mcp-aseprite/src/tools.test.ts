import { EXAMPLE_SPRITE_SPEC, type SpriteSpec } from "@asistente/shared";
import { existsSync, rmSync } from "node:fs";
import { resolve, sep } from "node:path";
import { afterAll, describe, expect, it, vi } from "vitest";
import { AsepriteBridgeError, type AsepriteBridge } from "./bridge/ws-server.js";
import {
  describeCapabilities,
  describeToolError,
  exportSpritesheet,
  generateSprite,
  type ToolContext,
} from "./tools.js";
import { UnsafeOutputPathError } from "./output-paths.js";

const OUT = resolve(process.cwd(), "output");

function clone(spec: SpriteSpec): SpriteSpec {
  return JSON.parse(JSON.stringify(spec)) as SpriteSpec;
}

/** Puente falso: registra los scripts enviados sin necesitar socket ni Aseprite. */
function fakeBridge(
  behaviour: (lua: string) => string | Promise<string> = () => "OK",
  options: { isConnected?: boolean; port?: number } = {},
): { bridge: AsepriteBridge; sent: string[] } {
  const sent: string[] = [];
  const bridge = {
    port: options.port ?? 3001,
    isConnected: options.isConnected ?? true,
    sendLua: vi.fn(async (lua: string) => {
      sent.push(lua);
      return behaviour(lua);
    }),
  } as unknown as AsepriteBridge;
  return { bridge, sent };
}

// generateSprite crea el directorio de salida como efecto secundario deliberado.
afterAll(() => {
  rmSync(resolve(process.cwd(), "output"), { recursive: true, force: true });
});

describe("generateSprite", () => {
  it("crea el directorio de salida: Aseprite no crea directorios por su cuenta", async () => {
    rmSync(OUT, { recursive: true, force: true });
    const { bridge } = fakeBridge();

    await generateSprite({ bridge, outputDir: "output" }, EXAMPLE_SPRITE_SPEC);

    expect(existsSync(OUT)).toBe(true);
  });

  it("envía UN solo script y devuelve las rutas y el recuento de frames", async () => {
    const { bridge, sent } = fakeBridge(() => "OK frames=1 tags=1 palette=5");
    const context: ToolContext = { bridge, outputDir: "output" };

    const result = await generateSprite(context, EXAMPLE_SPRITE_SPEC);

    expect(sent).toHaveLength(1);
    expect(result.frameCount).toBe(1);
    expect(result.filePath).toBe(resolve(OUT, "gem-icon.aseprite"));
    expect(result.spritesheetPath).toBe(resolve(OUT, "gem-icon.png"));
    expect(result.asepriteStatus).toBe("OK frames=1 tags=1 palette=5");
  });

  it("un spec de 8 frames genera exactamente UN mensaje por el WebSocket", async () => {
    // Es la regla de oro del protocolo: una tarea = un script = un round-trip.
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames = Array.from({ length: 8 }, (_, index) => ({
      index,
      durationMs: 80 + index,
      pixels: spec.frames[0]!.pixels,
    }));
    spec.tags = [{ name: "walk", from: 0, to: 7, direction: "forward" }];

    const { bridge, sent } = fakeBridge();
    await generateSprite({ bridge, outputDir: "output" }, spec);

    expect(sent).toHaveLength(1);
    expect(bridge.sendLua).toHaveBeenCalledTimes(1);
  });

  it("un nombre con traversal no escapa de output/", async () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    // Saltamos la validación de Zod a propósito: simulamos un spec ya parseado cuyo nombre
    // fuera hostil, para comprobar que la defensa en profundidad del emisor aguanta.
    (spec as { name: string }).name = "../../evil";

    const { bridge } = fakeBridge();
    const result = await generateSprite({ bridge, outputDir: "output" }, spec);

    expect(result.filePath).toBe(resolve(OUT, "evil.aseprite"));
    expect(result.filePath.startsWith(OUT + sep)).toBe(true);
  });

  it("propaga los avisos de producción junto al resultado", async () => {
    const spec = clone(EXAMPLE_SPRITE_SPEC);
    spec.frames = [0, 1, 2].map((index) => ({
      index,
      durationMs: 100,
      pixels: spec.frames[0]!.pixels,
    }));
    spec.tags = [{ name: "idle", from: 0, to: 2, direction: "forward" }];

    const { bridge } = fakeBridge();
    const result = await generateSprite({ bridge, outputDir: "output" }, spec);

    expect(result.warnings.join(" ")).toMatch(/sin peso/u);
  });

  it("deja subir el error real de Lua sin envolverlo en un genérico", async () => {
    const { bridge } = fakeBridge(() => {
      throw new AsepriteBridgeError("lua_error", "[mcp]:12: bad argument #1 to 'drawPixel'");
    });

    await expect(generateSprite({ bridge, outputDir: "output" }, EXAMPLE_SPRITE_SPEC)).rejects
      .toMatchObject({ code: "lua_error" });
  });
});

describe("exportSpritesheet", () => {
  it("reexporta derivando png y json del .aseprite", async () => {
    const { bridge, sent } = fakeBridge(() => "OK frames=4");

    const result = await exportSpritesheet(
      { bridge, outputDir: "output" },
      { filePath: "gem-icon.aseprite" },
    );

    expect(sent).toHaveLength(1);
    expect(result.spritesheetPath).toBe(resolve(OUT, "gem-icon.png"));
    expect(result.jsonPath).toBe(resolve(OUT, "gem-icon.json"));
  });

  it("devuelve jsonPath null cuando no se pide JSON", async () => {
    const { bridge } = fakeBridge();
    const result = await exportSpritesheet(
      { bridge, outputDir: "output" },
      { filePath: "gem-icon.aseprite", generateJson: false },
    );

    expect(result.jsonPath).toBeNull();
  });

  it("rechaza un filePath que intenta salir del directorio de salida", async () => {
    const { bridge, sent } = fakeBridge();

    await expect(
      exportSpritesheet({ bridge, outputDir: "output" }, { filePath: "../../etc/passwd" }),
    ).rejects.toBeInstanceOf(UnsafeOutputPathError);

    // Y no llegó a enviarse nada a Aseprite.
    expect(sent).toHaveLength(0);
  });
});

describe("describeCapabilities", () => {
  it("informa de que el connector no está vivo sin intentar enviar Lua", async () => {
    const { bridge, sent } = fakeBridge(() => "no debería llamarse", { isConnected: false });

    const result = await describeCapabilities({ bridge, outputDir: "output" });

    expect(result.connectorAlive).toBe(false);
    expect(result.asepriteVersion).toBeNull();
    expect(result.detail).toMatch(/connector\.lua/u);
    expect(sent).toHaveLength(0);
  });

  it("extrae la versión de Aseprite del resumen", async () => {
    const { bridge } = fakeBridge(() => "version=1.3.7 | apiVersion=24 | activeSprite=none");

    const result = await describeCapabilities({ bridge, outputDir: "output" });

    expect(result.connectorAlive).toBe(true);
    expect(result.asepriteVersion).toBe("1.3.7");
    expect(result.knownLimits.length).toBeGreaterThan(0);
  });

  it("no revienta si el connector está conectado pero falla al ejecutar", async () => {
    const { bridge } = fakeBridge(() => {
      throw new AsepriteBridgeError("timeout", "Aseprite no respondió en 30000 ms.");
    });

    const result = await describeCapabilities({ bridge, outputDir: "output" });

    expect(result.connectorAlive).toBe(false);
    expect(result.detail).toMatch(/no respondió/u);
  });
});

describe("describeToolError", () => {
  it("marca un error de Lua con el mensaje real de Aseprite", () => {
    const message = describeToolError(
      new AsepriteBridgeError("lua_error", "[mcp]:3: attempt to index a nil value"),
    );
    expect(message).toContain("[mcp]:3: attempt to index a nil value");
  });

  it("devuelve tal cual el mensaje accionable de 'no conectado'", () => {
    const message = describeToolError(
      new AsepriteBridgeError("not_connected", "El connector de Aseprite no está conectado..."),
    );
    expect(message).toMatch(/no está conectado/u);
  });

  it("explica una ruta no permitida", () => {
    expect(describeToolError(new UnsafeOutputPathError("escapa"))).toMatch(/no permitida/u);
  });

  it("degrada con gracia ante un error desconocido", () => {
    expect(describeToolError(new Error("cualquier cosa"))).toBe("cualquier cosa");
    expect(describeToolError("string suelta")).toBe("string suelta");
  });
});
