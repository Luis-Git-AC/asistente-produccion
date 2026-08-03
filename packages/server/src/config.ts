import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

/**
 * Configuración centralizada y validada con Zod al arrancar.
 *
 * Se valida una sola vez, al principio: si falta algo, el proceso muere con un mensaje que dice
 * exactamente qué variable falta y para qué sirve. Un fallo aquí es infinitamente más barato que
 * descubrir a mitad de una petición que `ANTHROPIC_API_KEY` no estaba puesta.
 */

const booleanish = z
  .string()
  .transform((value) => {
    const normalized = value.trim().toLowerCase();
    return normalized === "1" || normalized === "true";
  });

const positiveIntFromString = (fallback: number): z.ZodType<number> =>
  z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? fallback : Number(value)))
    .refine((value) => Number.isInteger(value) && value > 0, {
      message: "debe ser un entero positivo",
    });

const ConfigSchema = z.object({
  ANTHROPIC_API_KEY: z
    .string()
    .min(1, "ANTHROPIC_API_KEY es obligatoria: sin ella no se puede llamar al modelo.")
    .optional(),
  PORT: positiveIntFromString(3000),
  ASEPRITE_WS_PORT: positiveIntFromString(3001),
  DB_PATH: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? "./data/asistente.db" : value)),
  CACHE_TTL_SECONDS: positiveIntFromString(86_400),
  SIMULATE_5XX: booleanish.optional().transform((value) => value ?? false),
  /** Orígenes permitidos por CORS, separados por coma. Por defecto, el dev server de Vite. */
  CORS_ORIGINS: z
    .string()
    .optional()
    .transform((value) =>
      (value === undefined || value.trim() === "" ? "http://localhost:5173" : value)
        .split(",")
        .map((origin) => origin.trim())
        .filter((origin) => origin !== ""),
    ),
  /** Directorio donde el MCP escribe los assets. Relativo a la raíz del repo. */
  ASEPRITE_OUTPUT_DIR: z
    .string()
    .optional()
    .transform((value) => (value === undefined || value.trim() === "" ? "output" : value)),
});

export interface ServerConfig {
  anthropicApiKey: string | undefined;
  port: number;
  asepriteWsPort: number;
  dbPath: string;
  cacheTtlSeconds: number;
  simulate5xx: boolean;
  corsOrigins: string[];
  asepriteOutputDir: string;
}

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConfigError";
  }
}

export interface LoadConfigOptions {
  env?: NodeJS.ProcessEnv;
  /**
   * Si es `true`, la ausencia de `ANTHROPIC_API_KEY` es un error fatal. Los tests cargan la
   * configuración sin exigirla porque nunca llegan a llamar a la API.
   */
  requireApiKey?: boolean;
}

/**
 * Directorio donde `ant auth login` guarda los perfiles OAuth. Que exista significa que el SDK
 * probablemente pueda resolver una credencial por su cuenta.
 */
export function antConfigDir(env: NodeJS.ProcessEnv = process.env): string {
  const explicit = env["ANTHROPIC_CONFIG_DIR"];
  if (explicit !== undefined && explicit.trim() !== "") return explicit;
  if (process.platform === "win32") {
    return join(env["APPDATA"] ?? join(homedir(), "AppData", "Roaming"), "Anthropic");
  }
  return join(homedir(), ".config", "anthropic");
}

/**
 * ¿Hay ALGUNA credencial utilizable?
 *
 * Que `ANTHROPIC_API_KEY` no esté definida NO significa que no haya credenciales: el SDK resuelve
 * también `ANTHROPIC_AUTH_TOKEN` y los perfiles de `ant auth login`. Comprobar sólo la key hacía
 * que el arranque se negara a funcionar en un entorno perfectamente válido — y encima el mensaje
 * de error mencionaba `ant auth login` como alternativa que el código nunca aceptaba.
 */
export function hasAnyCredential(env: NodeJS.ProcessEnv = process.env): boolean {
  if ((env["ANTHROPIC_API_KEY"] ?? "").trim() !== "") return true;
  if ((env["ANTHROPIC_AUTH_TOKEN"] ?? "").trim() !== "") return true;
  return existsSync(join(antConfigDir(env), "credentials"));
}

/**
 * Raíz del monorepo, derivada de la ubicación de este módulo y no de `process.cwd()`.
 *
 * `config.ts` vive en `packages/server/src/` y su build en `packages/server/dist/`: ambos están
 * tres niveles por debajo de la raíz, así que el cálculo vale igual en desarrollo y compilado.
 *
 * Hace falta porque el servidor y el proceso hijo del MCP se ejecutan con `cwd` DISTINTO
 * (`packages/server` y la raíz, respectivamente). Resolver rutas relativas contra `cwd` hacía que
 * el MCP escribiera los assets en un sitio y el servidor los buscara en otro.
 */
export function repoRoot(): string {
  return resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
}

/** Convierte una ruta de configuración en absoluta, anclándola a la raíz del repo si es relativa. */
export function resolveFromRepoRoot(pathLike: string): string {
  return isAbsolute(pathLike) ? pathLike : resolve(repoRoot(), pathLike);
}

/**
 * Busca el `.env` subiendo desde un directorio de partida hasta la raíz del sistema.
 *
 * Es imprescindible en un monorepo: `npm run dev -w @asistente/server` ejecuta con
 * `cwd = packages/server`, no la raíz del repo, así que mirar sólo en `process.cwd()` no
 * encuentra el `.env` y el servidor se niega a arrancar diciendo que falta la credencial
 * mientras el usuario la está viendo en el fichero.
 */
export function findDotEnv(startDir: string = process.cwd()): string | undefined {
  let current = resolve(startDir);

  for (;;) {
    const candidate = join(current, ".env");
    if (existsSync(candidate)) return candidate;

    const parent = dirname(current);
    if (parent === current) return undefined; // llegamos a la raíz del sistema
    current = parent;
  }
}

/**
 * Carga el `.env` dentro de `process.env`, si se encuentra.
 *
 * `process.loadEnvFile` es nativo desde Node 20.12/22, así que no hace falta `dotenv`.
 * Las variables ya presentes en el entorno NO se sobrescriben: la shell gana sobre el fichero,
 * que es lo que se espera al hacer `SIMULATE_5XX=1 npm run dev`.
 */
export function loadDotEnv(envPath?: string): boolean {
  const target = envPath ?? findDotEnv();
  if (target === undefined || !existsSync(target)) return false;
  try {
    process.loadEnvFile(target);
    return true;
  } catch {
    // Un .env mal formado no debe impedir arrancar si las variables vienen de la shell.
    return false;
  }
}

export function loadConfig(options: LoadConfigOptions = {}): ServerConfig {
  const env = options.env ?? process.env;
  const parsed = ConfigSchema.safeParse(env);

  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "<raíz>"}: ${issue.message}`)
      .join("\n");
    throw new ConfigError(`Configuración inválida:\n${issues}\n\nRevisa .env.example.`);
  }

  const data = parsed.data;

  if (options.requireApiKey === true && !hasAnyCredential(env)) {
    throw new ConfigError(
      [
        "No se encontró ninguna credencial de Anthropic.",
        "",
        "Vale cualquiera de estas tres, en este orden de precedencia:",
        "",
        "  1. ANTHROPIC_API_KEY   — clave de la API (console.anthropic.com > API keys)",
        '     PowerShell:  $env:ANTHROPIC_API_KEY = "sk-ant-..."',
        '     bash:        export ANTHROPIC_API_KEY="sk-ant-..."',
        "     o en un fichero .env en la raíz del repo (está en .gitignore)",
        "",
        "  2. ANTHROPIC_AUTH_TOKEN — token OAuth de corta duración",
        "",
        "  3. Un perfil de `ant auth login` (el SDK lo resuelve solo)",
        "",
        "Ojo: una suscripción de Claude.ai NO es lo mismo que acceso a la API.",
        "La API se factura aparte, desde console.anthropic.com.",
        "",
        "Ver .env.example para el resto de variables.",
      ].join("\n"),
    );
  }

  return {
    anthropicApiKey: data.ANTHROPIC_API_KEY,
    port: data.PORT,
    asepriteWsPort: data.ASEPRITE_WS_PORT,
    // Rutas ABSOLUTAS ancladas a la raíz del repo. Devolverlas relativas dejaba que cada proceso
    // las resolviera contra su propio `cwd`: el MCP escribía en <raíz>/output y el servidor
    // buscaba en packages/server/output, con el preview dando 404 pese a existir el fichero.
    dbPath: resolveFromRepoRoot(data.DB_PATH),
    cacheTtlSeconds: data.CACHE_TTL_SECONDS,
    simulate5xx: data.SIMULATE_5XX,
    corsOrigins: data.CORS_ORIGINS,
    asepriteOutputDir: resolveFromRepoRoot(data.ASEPRITE_OUTPUT_DIR),
  };
}
