import { join } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Todas las rutas del runner se resuelven desde ESTE módulo, nunca desde `process.cwd()`.
 *
 * `npm run evals` se lanza desde la raíz del monorepo, pero `npm run evals -w @asistente/evals`
 * lo lanza con `cwd` dentro del paquete: cualquier ruta relativa al cwd se rompería en uno de
 * los dos casos, y el fallo sería un "no encuentro los casos" en vez de algo que apunte al cwd.
 */
export const EVALS_ROOT = fileURLToPath(new URL("../", import.meta.url));

export const CASES_DIR = join(EVALS_ROOT, "cases");
export const FIXTURES_DIR = join(EVALS_ROOT, "fixtures");
export const REPORTS_DIR = join(EVALS_ROOT, "reports");
export const THRESHOLDS_PATH = join(EVALS_ROOT, "thresholds.json");
export const BASELINE_PATH = join(EVALS_ROOT, "baseline.json");
