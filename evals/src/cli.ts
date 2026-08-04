import { parseArgs } from "node:util";
import { MODEL_IDS, type ModelId } from "@asistente/shared";

export class CliError extends Error {}

export interface CliOptions {
  help: boolean;
  /** `true` = usar `evals/fixtures/`; `false` = llamar a la API. */
  fixtures: boolean;
  /** Graba las respuestas reales en `evals/fixtures/`. Implica corrida en vivo. */
  record: boolean;
  caseIds: string[];
  model: ModelId;
  /** Ruta del informe JSON. Por defecto `evals/reports/<timestamp>.json`. */
  jsonPath: string | null;
  concurrency: number;
  updateBaseline: boolean;
  /** No escribe el informe en disco (útil en corridas de un solo caso). */
  noReport: boolean;
}

export const DEFAULT_CONCURRENCY = 4;

export const USAGE = `
Uso: npm run evals -- [opciones]

  --fixtures            Usa las respuestas grabadas en evals/fixtures/ (sin red, sin coste).
  --record              Llama a la API y regraba los fixtures de los casos ejecutados.
  --case <id>           Ejecuta sólo ese caso. Repetible.
  --model <id>          Modelo a evaluar (${MODEL_IDS.join(" | ")}). Por defecto ${MODEL_IDS[0]}.
  --json <path>         Ruta del informe JSON.
  --concurrency <n>     Casos en paralelo (por defecto ${String(DEFAULT_CONCURRENCY)}).
  --update-baseline     Reescribe evals/baseline.json con esta corrida.
  --no-report           No escribe el informe en disco.
  --help                Esta ayuda.

Códigos de salida: 0 todo en verde · 1 algún umbral incumplido · 2 error de configuración.
`.trim();

function toModelId(value: string): ModelId {
  const model = MODEL_IDS.find((id) => id === value);
  if (model === undefined) {
    throw new CliError(`modelo desconocido "${value}". Válidos: ${MODEL_IDS.join(", ")}.`);
  }
  return model;
}

function toConcurrency(value: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new CliError(`--concurrency debe ser un entero ≥ 1, recibido "${value}".`);
  }
  return parsed;
}

export function parseCliArgs(argv: readonly string[]): CliOptions {
  let parsed;
  try {
    parsed = parseArgs({
      args: [...argv],
      options: {
        fixtures: { type: "boolean", default: false },
        record: { type: "boolean", default: false },
        case: { type: "string", multiple: true, default: [] },
        model: { type: "string" },
        json: { type: "string" },
        concurrency: { type: "string" },
        "update-baseline": { type: "boolean", default: false },
        "no-report": { type: "boolean", default: false },
        help: { type: "boolean", default: false },
      },
      allowPositionals: false,
      strict: true,
    });
  } catch (error) {
    throw new CliError((error as Error).message);
  }

  const values = parsed.values;

  // `--fixtures --record` es una contradicción, no una combinación: grabar exige llamar a la
  // API. Fallar aquí evita la sorpresa cara de creer que se está grabando y no estar haciéndolo.
  if (values.fixtures === true && values.record === true) {
    throw new CliError("--fixtures y --record son incompatibles: grabar requiere llamar a la API.");
  }

  const modelValue = values.model;
  const concurrencyValue = values.concurrency;
  const jsonValue = values.json;

  return {
    help: values.help === true,
    fixtures: values.fixtures === true,
    record: values.record === true,
    caseIds: values.case ?? [],
    model: modelValue === undefined ? MODEL_IDS[0] : toModelId(modelValue),
    jsonPath: jsonValue === undefined ? null : jsonValue,
    concurrency:
      concurrencyValue === undefined ? DEFAULT_CONCURRENCY : toConcurrency(concurrencyValue),
    updateBaseline: values["update-baseline"] === true,
    noReport: values["no-report"] === true,
  };
}
