import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadConfig, repoRoot, resolveFromRepoRoot } from "./config.js";

/**
 * El servidor y el proceso hijo del MCP corren con `cwd` distinto (`packages/server` y la raíz).
 * Si la configuración devolviera rutas relativas, cada uno las resolvería contra su propio `cwd`
 * y acabarían apuntando a directorios distintos — que es exactamente el bug que dejaba el
 * preview en 404 con el fichero ya escrito en disco.
 */

describe("repoRoot", () => {
  it("apunta a la raíz del monorepo, no al paquete", () => {
    const root = repoRoot();

    expect(isAbsolute(root)).toBe(true);
    // La raíz es la que contiene los workspaces y el package.json del monorepo.
    expect(existsSync(resolve(root, "package.json"))).toBe(true);
    expect(existsSync(resolve(root, "packages", "server", "package.json"))).toBe(true);
    expect(root.endsWith(join("packages", "server"))).toBe(false);
  });

  it("no depende de process.cwd()", () => {
    // Es la garantía que importa: servidor y MCP corren con cwd distinto y deben coincidir.
    const before = repoRoot();
    const original = process.cwd();
    try {
      process.chdir(tmpdir());
      expect(repoRoot()).toBe(before);
    } finally {
      process.chdir(original);
    }
  });
});

describe("resolveFromRepoRoot", () => {
  it("ancla una ruta relativa a la raíz del repo", () => {
    expect(resolveFromRepoRoot("output")).toBe(resolve(repoRoot(), "output"));
  });

  it("respeta una ruta ya absoluta", () => {
    const absolute = process.platform === "win32" ? "C:\\tmp\\assets" : "/tmp/assets";
    expect(resolveFromRepoRoot(absolute)).toBe(absolute);
  });
});

describe("loadConfig: rutas", () => {
  it("devuelve asepriteOutputDir y dbPath absolutos", () => {
    const config = loadConfig({ env: { ASEPRITE_OUTPUT_DIR: "output", DB_PATH: "./data/x.db" } });

    expect(isAbsolute(config.asepriteOutputDir)).toBe(true);
    expect(isAbsolute(config.dbPath)).toBe(true);
    expect(config.asepriteOutputDir).toBe(resolve(repoRoot(), "output"));
  });

  it("los valores por defecto también salen absolutos", () => {
    const config = loadConfig({ env: {} });

    expect(isAbsolute(config.asepriteOutputDir)).toBe(true);
    expect(isAbsolute(config.dbPath)).toBe(true);
  });
});
