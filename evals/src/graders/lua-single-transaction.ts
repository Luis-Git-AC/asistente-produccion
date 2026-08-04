import luaparse from "luaparse";
import type { CaseGrader } from "../types.js";
import { check, noSpecResult, scoreChecks, type Check } from "./checks.js";

/** Literal RGBA empaquetado: la forma que cruza los canales R y B dentro de Aseprite. */
const PACKED_RGBA_RE = /0x[0-9A-Fa-f]{8}\b/u;
const TRANSACTION_RE = /app\.transaction\s*\(/gu;
const COMMAND_RE = /app\.command\.\w+\s*\{/gu;
const UI_FALSE_RE = /\bui\s*=\s*false\b/gu;
const BLOCKING_UI_RE = /\bapp\.alert\b|\bDialog\s*[({]/u;

function countMatches(source: string, pattern: RegExp): number {
  return source.match(pattern)?.length ?? 0;
}

/**
 * El Lua emitido es la frontera con Aseprite, y todo lo que falla ahí falla en runtime, dentro
 * de la UI de otro proceso, y vuelve como una cadena por el WebSocket (o no vuelve). Este grader
 * codifica las cuatro trampas que ya costaron una sesión de depuración cada una:
 *
 *  - **Una sola `app.transaction`**: la regla del protocolo. Una tarea = un script = una llamada
 *    MCP = una transacción. Si el emisor empieza a abrir varias, el cuello de botella (el
 *    round-trip del WebSocket) vuelve a crecer sin que nada más lo note.
 *  - **Nada que bloquee el hilo de UI**: `app.alert`, un `Dialog` modal o un `app.command` sin
 *    `ui = false` cuelgan Aseprite y con él el socket. El síntoma es un timeout, que es el fallo
 *    más caro de diagnosticar del puente.
 *  - **Colores por componentes**: un `0xRRGGBBAA` entra con R y B cruzados porque Aseprite
 *    empaqueta en little-endian. Ni el snapshot ni el test de sintaxis lo ven; sólo se nota
 *    abriendo el PNG.
 *  - **Sintaxis válida**: se parsea aquí para que el error salga en la suite y no en Aseprite.
 */
export const luaSingleTransactionGrader: CaseGrader = {
  id: "lua-emits-single-transaction",
  description: "El Lua emitido tiene una transacción, no bloquea la UI y compila.",
  appliesTo: () => true,
  grade(context) {
    if (context.spec === null || context.lua === null) return noSpecResult();
    const lua = context.lua;

    const transactions = countMatches(lua, TRANSACTION_RE);
    const commands = countMatches(lua, COMMAND_RE);
    const uiFalse = countMatches(lua, UI_FALSE_RE);
    const packed = PACKED_RGBA_RE.exec(lua);

    let parseError: string | null = null;
    try {
      luaparse.parse(lua, { luaVersion: "5.3" });
    } catch (error) {
      parseError = (error as Error).message;
    }

    const checks: Check[] = [
      check(
        "exactamente una app.transaction",
        transactions === 1,
        `${String(transactions)} transacción(es)`,
      ),
      check("sin app.alert ni Dialog", !BLOCKING_UI_RE.test(lua), "el script bloquearía la UI"),
      check(
        "todo app.command con ui = false",
        commands === 0 || uiFalse >= commands,
        `${String(commands)} comando(s), ${String(uiFalse)} con ui = false`,
      ),
      check(
        "colores por componentes",
        packed === null,
        `literal RGBA empaquetado: ${packed?.[0] ?? ""}`,
      ),
      check("sintaxis Lua válida", parseError === null, parseError ?? ""),
    ];

    return scoreChecks(checks);
  },
};
