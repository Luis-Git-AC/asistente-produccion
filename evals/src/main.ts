import { buildBaseline, compareToBaseline, loadBaseline, writeBaseline } from "./baseline.js";
import { filterCases, loadCases } from "./cases.js";
import { CliError, USAGE, parseCliArgs } from "./cli.js";
import { defaultReportPath, formatConsoleReport, writeReport } from "./report.js";
import { createLiveSource, fixtureSource, type ResponseSource } from "./response-source.js";
import { runEvals } from "./run.js";
import { loadThresholds } from "./thresholds.js";
import type { RunReport } from "./types.js";

/**
 * Entrypoint ejecutable de la suite. Es un fichero aparte a propósito: nada de decidir "¿soy el
 * módulo principal?" comparando `import.meta.url` con `process.argv[1]`, que con tsx, symlinks y
 * rutas de Windows falla de formas distintas y en silencio.
 */

const EXIT_OK = 0;
const EXIT_THRESHOLD = 1;
const EXIT_CONFIG = 2;

async function main(): Promise<number> {
  const options = parseCliArgs(process.argv.slice(2));
  if (options.help) {
    console.log(USAGE);
    return EXIT_OK;
  }

  const cases = filterCases(loadCases(), options.caseIds);
  if (cases.length === 0) {
    throw new CliError("no hay casos que ejecutar.");
  }
  const thresholds = loadThresholds();

  let source: ResponseSource;
  if (options.fixtures) {
    source = fixtureSource;
  } else {
    console.error(
      `[evals] modo EN VIVO: ${String(cases.length)} llamada(s) reales a la API` +
        `${options.record ? " (regrabando fixtures)" : ""}. Usa --fixtures para no gastar.`,
    );
    source = await createLiveSource({ record: options.record });
  }

  const report = await runEvals({
    cases,
    thresholds,
    model: options.model,
    source,
    concurrency: options.concurrency,
  });

  const baseline = loadBaseline();
  const finalReport: RunReport = {
    ...report,
    regressions: compareToBaseline(report, baseline),
  };

  console.log(formatConsoleReport(finalReport));

  if (!options.noReport) {
    const path = writeReport(
      finalReport,
      options.jsonPath ?? defaultReportPath(finalReport.generatedAt),
    );
    console.log(`Informe: ${path}\n`);
  }

  if (options.updateBaseline) {
    writeBaseline(buildBaseline(finalReport));
    console.log("baseline.json actualizado con esta corrida.\n");
  }

  return finalReport.failures.length === 0 ? EXIT_OK : EXIT_THRESHOLD;
}

try {
  process.exitCode = await main();
} catch (error) {
  if (error instanceof CliError) {
    console.error(`\n[evals] ${error.message}\n`);
    console.error(USAGE);
  } else {
    // El error REAL, con stack: un fallo de configuración sin pista es justo el que más cuesta.
    console.error(`\n[evals] ${(error as Error).message}`);
    if (error instanceof Error && error.stack !== undefined) console.error(error.stack);
  }
  process.exitCode = EXIT_CONFIG;
}
