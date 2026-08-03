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

  if (options.requireApiKey === true && (data.ANTHROPIC_API_KEY ?? "") === "") {
    throw new ConfigError(
      [
        "Falta ANTHROPIC_API_KEY.",
        "",
        "Ponla en el entorno antes de arrancar:",
        '  $env:ANTHROPIC_API_KEY = "sk-ant-..."   (PowerShell)',
        '  export ANTHROPIC_API_KEY="sk-ant-..."   (bash)',
        "",
        "También vale `ant auth login`: el SDK resuelve el perfil por su cuenta.",
        "Ver .env.example para el resto de variables.",
      ].join("\n"),
    );
  }

  return {
    anthropicApiKey: data.ANTHROPIC_API_KEY,
    port: data.PORT,
    asepriteWsPort: data.ASEPRITE_WS_PORT,
    dbPath: data.DB_PATH,
    cacheTtlSeconds: data.CACHE_TTL_SECONDS,
    simulate5xx: data.SIMULATE_5XX,
    corsOrigins: data.CORS_ORIGINS,
    asepriteOutputDir: data.ASEPRITE_OUTPUT_DIR,
  };
}
