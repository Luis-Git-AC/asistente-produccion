import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { findDotEnv, loadDotEnv } from "./config.js";

/**
 * `loadDotEnv` muta `process.env`, así que cada test limpia sus propias claves. Se usan nombres
 * con prefijo para no pisar variables reales del entorno de CI.
 */

const dirs: string[] = [];
const touchedKeys = new Set<string>();

function writeEnvFile(contents: string): string {
  const dir = mkdtempSync(join(tmpdir(), "asistente-env-"));
  dirs.push(dir);
  const file = join(dir, ".env");
  writeFileSync(file, contents);
  return file;
}

afterEach(() => {
  for (const key of touchedKeys) delete process.env[key];
  touchedKeys.clear();
  while (dirs.length > 0) rmSync(dirs.pop() ?? "", { recursive: true, force: true });
});

describe("findDotEnv", () => {
  it("encuentra el .env de la raíz del monorepo desde un subpaquete", () => {
    // ESTE es el caso real: `npm run dev -w @asistente/server` ejecuta con
    // cwd = packages/server, no la raíz. Buscar sólo en cwd no encontraba nada y el servidor
    // se negaba a arrancar con la credencial delante.
    const root = mkdtempSync(join(tmpdir(), "asistente-monorepo-"));
    dirs.push(root);
    const packageDir = join(root, "packages", "server");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(root, ".env"), "TEST_DOTENV_ROOT=si\n");

    expect(findDotEnv(packageDir)).toBe(join(root, ".env"));
  });

  it("prefiere el .env más cercano al punto de partida", () => {
    const root = mkdtempSync(join(tmpdir(), "asistente-monorepo-"));
    dirs.push(root);
    const packageDir = join(root, "packages", "server");
    mkdirSync(packageDir, { recursive: true });
    writeFileSync(join(root, ".env"), "X=raiz\n");
    writeFileSync(join(packageDir, ".env"), "X=paquete\n");

    expect(findDotEnv(packageDir)).toBe(join(packageDir, ".env"));
  });

  it("devuelve undefined si no hay ninguno hasta la raíz del sistema", () => {
    const empty = mkdtempSync(join(tmpdir(), "asistente-vacio-"));
    dirs.push(empty);
    const deep = join(empty, "a", "b", "c");
    mkdirSync(deep, { recursive: true });

    // Puede haber un .env real en algún ancestro del tmpdir; se comprueba que, de haberlo,
    // no es ninguno de los directorios que acabamos de crear.
    const found = findDotEnv(deep);
    expect(found === undefined || !found.startsWith(empty)).toBe(true);
  });
});

describe("loadDotEnv", () => {
  it("carga las variables del fichero en process.env", () => {
    touchedKeys.add("TEST_DOTENV_ALPHA");
    const file = writeEnvFile("TEST_DOTENV_ALPHA=desde-fichero\n");

    expect(loadDotEnv(file)).toBe(true);
    expect(process.env["TEST_DOTENV_ALPHA"]).toBe("desde-fichero");
  });

  it("ignora comentarios y líneas en blanco", () => {
    touchedKeys.add("TEST_DOTENV_BETA");
    const file = writeEnvFile("# un comentario\n\nTEST_DOTENV_BETA=valor\n");

    loadDotEnv(file);

    expect(process.env["TEST_DOTENV_BETA"]).toBe("valor");
  });

  it("la shell gana sobre el fichero", () => {
    // Es lo que permite `SIMULATE_5XX=1 npm run dev` sin editar el .env.
    touchedKeys.add("TEST_DOTENV_GAMMA");
    process.env["TEST_DOTENV_GAMMA"] = "desde-shell";
    const file = writeEnvFile("TEST_DOTENV_GAMMA=desde-fichero\n");

    loadDotEnv(file);

    expect(process.env["TEST_DOTENV_GAMMA"]).toBe("desde-shell");
  });

  it("devuelve false si el fichero no existe, sin lanzar", () => {
    expect(loadDotEnv(join(tmpdir(), "no-existe-jamas", ".env"))).toBe(false);
  });
});
