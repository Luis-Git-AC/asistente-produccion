#!/usr/bin/env node
/**
 * Punto de entrada ejecutable del MCP server.
 *
 * Existe separado de `server.ts` a propósito: un guard del tipo
 * `if (import.meta.url === process.argv[1])` es frágil (tsx, symlinks y rutas de Windows lo
 * rompen de formas distintas), y cuando falla el servidor arranca en silencio sin escuchar,
 * dejando al cliente MCP colgado esperando el `initialize`. Con un fichero de entrada dedicado
 * no hay condición que evaluar: si se ejecuta, arranca.
 */
import { log, main } from "./server.js";

main().catch((error: unknown) => {
  log(`fallo al arrancar: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
