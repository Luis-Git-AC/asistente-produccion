import { resolve, sep } from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveExistingOutputPath,
  resolveOutputPaths,
  sanitizeAssetName,
  UnsafeOutputPathError,
} from "./output-paths.js";

const OUT = resolve(process.cwd(), "output");

describe("sanitizeAssetName", () => {
  it("deja intacto un slug válido", () => {
    expect(sanitizeAssetName("gem-icon")).toBe("gem-icon");
  });

  it("aplasta ../../evil a evil", () => {
    expect(sanitizeAssetName("../../evil")).toBe("evil");
  });

  it("aplasta rutas absolutas POSIX", () => {
    expect(sanitizeAssetName("/etc/passwd")).toBe("passwd");
  });

  it("aplasta rutas con separador de Windows", () => {
    expect(sanitizeAssetName("..\\..\\Windows\\System32\\evil")).toBe("evil");
  });

  it("elimina caracteres no seguros para un nombre de fichero", () => {
    expect(sanitizeAssetName("gem:icon*?<>|")).toBe("gem-icon");
  });

  it("quita puntos y guiones de los extremos", () => {
    expect(sanitizeAssetName("...gema...")).toBe("gema");
  });

  it("rechaza un nombre que se queda vacío en vez de inventar uno por defecto", () => {
    expect(() => sanitizeAssetName("../..")).toThrow(UnsafeOutputPathError);
    expect(() => sanitizeAssetName("///")).toThrow(UnsafeOutputPathError);
  });

  it("acota la longitud", () => {
    expect(sanitizeAssetName("a".repeat(200))).toHaveLength(64);
  });
});

describe("resolveOutputPaths", () => {
  it("genera las tres rutas dentro del directorio de salida", () => {
    const paths = resolveOutputPaths("gem-icon", "output");

    expect(paths.asepritePath).toBe(resolve(OUT, "gem-icon.aseprite"));
    expect(paths.spritesheetPath).toBe(resolve(OUT, "gem-icon.png"));
    expect(paths.jsonPath).toBe(resolve(OUT, "gem-icon.json"));
  });

  it("'../../evil' no escapa de output/", () => {
    const paths = resolveOutputPaths("../../evil", "output");

    expect(paths.name).toBe("evil");
    for (const p of [paths.asepritePath, paths.spritesheetPath, paths.jsonPath]) {
      expect(p.startsWith(OUT + sep)).toBe(true);
      expect(p).not.toContain("..");
    }
  });

  it("un nombre con traversal codificado tampoco escapa", () => {
    const paths = resolveOutputPaths("..%2f..%2fevil", "output");
    expect(paths.asepritePath.startsWith(OUT + sep)).toBe(true);
  });
});

describe("resolveExistingOutputPath", () => {
  it("acepta una ruta relativa dentro del directorio", () => {
    expect(resolveExistingOutputPath("gem-icon.aseprite", "output")).toBe(
      resolve(OUT, "gem-icon.aseprite"),
    );
  });

  it("rechaza salir del directorio con ..", () => {
    expect(() => resolveExistingOutputPath("../../etc/passwd", "output")).toThrow(
      UnsafeOutputPathError,
    );
  });

  it("rechaza una ruta absoluta fuera del directorio permitido", () => {
    const outside = process.platform === "win32" ? "C:\\Windows\\System32\\evil" : "/etc/passwd";
    expect(() => resolveExistingOutputPath(outside, "output")).toThrow(UnsafeOutputPathError);
  });

  it("acepta una ruta absoluta que ya está dentro del directorio", () => {
    const inside = resolve(OUT, "gem-icon.aseprite");
    expect(resolveExistingOutputPath(inside, "output")).toBe(inside);
  });

  it("no se deja engañar por un directorio hermano con prefijo común", () => {
    // 'output-evil' empieza por 'output' pero es otro directorio.
    expect(() => resolveExistingOutputPath(resolve(process.cwd(), "output-evil/x"), "output")).toThrow(
      UnsafeOutputPathError,
    );
  });
});
