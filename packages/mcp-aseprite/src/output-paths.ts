import { basename, isAbsolute, resolve, sep } from "node:path";

/**
 * Resolución de rutas de salida.
 *
 * `spec.name` lo genera el modelo, así que se trata como entrada hostil: todo nombre pasa por
 * `path.basename` y el resultado se verifica dentro del directorio permitido antes de usarse.
 * Nunca se concatena texto del modelo a una ruta sin pasar por aquí.
 */

export const DEFAULT_OUTPUT_DIR = "output";

export class UnsafeOutputPathError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsafeOutputPathError";
  }
}

/**
 * Reduce un nombre arbitrario a un slug seguro para nombre de fichero.
 * `../../evil` se convierte en `evil`; una cadena sin caracteres útiles es un error, no un
 * nombre por defecto silencioso.
 */
export function sanitizeAssetName(rawName: string): string {
  // basename() se lleva por delante cualquier componente de ruta, con separador POSIX o Windows.
  const withoutPaths = basename(rawName.replace(/\\/gu, "/"));
  const slug = withoutPaths
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/gu, "-")
    .replace(/^[.-]+/u, "")
    .replace(/[.-]+$/u, "")
    .slice(0, 64);

  if (slug === "") {
    throw new UnsafeOutputPathError(
      `El nombre "${rawName}" no contiene caracteres utilizables para un fichero.`,
    );
  }
  return slug;
}

export interface ResolvedOutputPaths {
  /** Directorio de salida absoluto. */
  outputDir: string;
  /** Nombre saneado, sin extensión. */
  name: string;
  asepritePath: string;
  spritesheetPath: string;
  jsonPath: string;
}

/**
 * Devuelve las rutas absolutas de salida para un asset, garantizando que todas caen dentro de
 * `outputDir`. Un nombre con traversal se sanea; si aun así el resultado escapara, se lanza.
 */
export function resolveOutputPaths(
  rawName: string,
  outputDir: string = DEFAULT_OUTPUT_DIR,
): ResolvedOutputPaths {
  const absoluteDir = isAbsolute(outputDir) ? resolve(outputDir) : resolve(process.cwd(), outputDir);
  const name = sanitizeAssetName(rawName);

  const build = (extension: string): string => {
    const candidate = resolve(absoluteDir, `${name}${extension}`);
    assertInsideDir(candidate, absoluteDir);
    return candidate;
  };

  return {
    outputDir: absoluteDir,
    name,
    asepritePath: build(".aseprite"),
    spritesheetPath: build(".png"),
    jsonPath: build(".json"),
  };
}

/**
 * Verificación final: la ruta resuelta tiene que estar dentro del directorio permitido.
 * Es la red de seguridad por si el saneado dejara pasar algo.
 */
export function assertInsideDir(candidate: string, allowedDir: string): void {
  const normalizedDir = resolve(allowedDir);
  const prefix = normalizedDir.endsWith(sep) ? normalizedDir : normalizedDir + sep;
  if (candidate !== normalizedDir && !candidate.startsWith(prefix)) {
    throw new UnsafeOutputPathError(
      `La ruta resuelta escapa del directorio de salida permitido: ${candidate}`,
    );
  }
}

/**
 * Valida una ruta que llega desde fuera (por ejemplo el `filePath` de `export_spritesheet`)
 * y la confina al directorio de salida.
 */
export function resolveExistingOutputPath(rawPath: string, outputDir: string = DEFAULT_OUTPUT_DIR): string {
  const absoluteDir = isAbsolute(outputDir) ? resolve(outputDir) : resolve(process.cwd(), outputDir);
  const candidate = isAbsolute(rawPath) ? resolve(rawPath) : resolve(absoluteDir, rawPath);
  assertInsideDir(candidate, absoluteDir);
  return candidate;
}
