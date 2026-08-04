# `@asistente/evals` — suite de evaluación

Mide el sistema en vez de mirarlo. Un set fijo de casos, graders deterministas, umbrales
versionados y un informe comparable entre ejecuciones.

```bash
npm run evals:fixtures    # offline, sin API key, sin coste — lo que corre en cada PR
npm run evals             # en vivo, llama a la API con el modelo por defecto
npm run evals:record      # en vivo + regraba evals/fixtures/
```

Códigos de salida: **0** todo en verde · **1** algún umbral incumplido · **2** error de
configuración (caso mal escrito, fixture obsoleto, flag inválido).

---

## Añadir un caso nuevo en 4 pasos

1. **Crea el fichero** `evals/cases/NN-mi-caso.json`. El prefijo numérico sólo fija el orden en
   el informe; el `id` va dentro y es un slug en kebab-case.

   ```json
   {
     "id": "mi-caso",
     "prompt": "Lo que escribiría un usuario, tal cual.",
     "tags": ["sprite", "paleta"],
     "notes": "Qué mide este caso y por qué merece existir.",
     "expectations": {
       "kind": "sprite",
       "canvas": { "width": 16, "height": 16 },
       "palette": { "max": 8 },
       "frames": { "exact": 1 },
       "tags": { "min": 1 }
     }
   }
   ```

   Las expectativas disponibles están en `ExpectationsSchema` (`src/cases.ts`). Sólo se ejecutan
   los graders cuya expectativa declares: un caso sin `palette` no puntúa `palette-constraint`.

2. **Graba el fixture** para que el caso pueda correr offline:

   ```bash
   npm run evals:record -- --case mi-caso
   ```

   Esto llama a la API una vez y escribe `evals/fixtures/mi-caso.claude-opus-5.json`.

3. **Comprueba que pasa offline** y mira qué mide de verdad:

   ```bash
   npm run evals -- --fixtures --case mi-caso
   ```

   Si un grader falla, decide si el fallo es del sistema (arréglalo) o del caso (la expectativa
   estaba mal escrita). Lo que **no** se hace es bajar el umbral.

4. **Rebendice la baseline** para que las próximas corridas comparen contra el nuevo estado:

   ```bash
   npm run evals -- --fixtures --update-baseline
   ```

   Commitea el caso, su fixture y `baseline.json` juntos.

---

## Qué mide cada grader

Ninguno del set base usa LLM-as-judge: un grader que llama al modelo mete ruido y coste en la
medida que sirve para juzgar al modelo.

| Grader                         | Aplica cuando                              | Mide                                                                                                                           |
| ------------------------------ | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `schema-valid`                 | siempre                                    | El texto parsea y valida contra `SpriteSpec`, invariantes cruzados incluidos. Binario.                                         |
| `palette-constraint`           | el caso declara `palette`                  | Que el nº de colores caiga en lo pedido **y** que todos pinten al menos un píxel.                                              |
| `canvas-constraint`            | `canvas`, `canvasMax` o `canvasMultipleOf` | Lienzo exacto (1), corregido a uno utilizable (0.5) o alucinado (0).                                                           |
| `frame-tag-coherence`          | expectativas de frames/tags                | Rangos válidos, sin solapes ni nombres repetidos, sin frames huérfanos, direcciones y ritmo pedidos.                           |
| `pixel-map-integrity`          | siempre                                    | Filas homogéneas, índices existentes, ningún frame vacío y cobertura mínima de píxeles.                                        |
| `lua-emits-single-transaction` | siempre                                    | El Lua emitido tiene **una** `app.transaction`, no bloquea la UI de Aseprite, construye los colores por componentes y compila. |
| `latency-budget`               | corrida                                    | p95 de latencia bajo `budgets.latencyP95Ms`.                                                                                   |
| `cost-budget`                  | corrida                                    | Coste medio por sprite bajo `budgets.costPerSpriteUsd`.                                                                        |
| `cross-language-consistency`   | hay pares `equivalentTo`                   | El mismo encargo en español y en inglés produce el mismo sprite.                                                               |

Un LLM-as-judge de legibilidad sería un añadido razonable, pero iría aparte y **no** contaría
para el código de salida.

**Los graders no abren Aseprite.** Operan sobre el `SpriteSpec` y sobre el Lua _emitido_, nunca
sobre un `.aseprite` renderizado: la suite tiene que correr en un runner de CI sin GUI.

---

## Umbrales y baseline

`thresholds.json` decide el código de salida. `baseline.json` no: es la foto de la última corrida
bendecida y sirve para responder a una pregunta distinta —"¿esto ha empeorado?"—. Una media que
cae de 0.99 a 0.92 sigue pasando un umbral de 0.9 y aun así es la señal que interesa ver, así que
las regresiones se **marcan** en el informe pero no rompen el build.

Quien rompe el build es el umbral, que está versionado. Si un umbral no se cumple: se arregla el
sistema, o se cambia el umbral **explicando por qué en el commit**. Bajarlo para que pase el
build es la forma más rápida de convertir esta suite en decoración.

---

## Fixtures

La clave de un fixture es `<caseId>.<model>.json` y **sólo** depende del caso y del modelo: nada
de timestamps, contadores ni hashes del contenido. El mismo caso resuelve siempre al mismo
fichero, así que el diff de una regrabación se lee como un diff normal.

Cada fixture guarda además `promptSha256`. Si el prompt del caso cambia y el fixture no se
regraba, la corrida **falla con código 2** en vez de seguir: un fixture obsoleto mide el sistema
de ayer y lo presenta como el de hoy.

El campo `origin` distingue dos cosas que conviene no confundir:

- `recorded` — salida real de la API, escrita por `npm run evals:record`.
- `synthetic-seed` — semilla escrita a mano para que la suite arranque en un clon sin API key.
  Los fixtures que hay ahora mismo en el repo son de este tipo: son specs válidos y
  representativos, pero **no** son la respuesta de una llamada real. Regrábalos antes de sacar
  conclusiones sobre la calidad del modelo.

---

## Un defecto conservado a propósito

`hero-walk-cycle` puntúa 0.83 en `frame-tag-coherence`: su tag `walk` cubre los frames 0–4 y deja
el 5 huérfano. Es un fallo real y frecuente —el spec valida perfectamente contra Zod, y el frame
suelto sólo se nota cuando el Animator de Unity no lo alcanza— y se conserva porque una suite en
la que todo puntúa 1.000 no demuestra que los graders funcionen, sólo que no han visto nada malo
todavía. Con él, subir el umbral de `frame-tag-coherence` a 1.0 rompe la corrida, que es la
prueba de que la suite tiene poder discriminante.

---

## Estructura

```
evals/
├─ cases/*.json        casos, validados con Zod al cargarlos
├─ fixtures/*.json     respuestas grabadas, clave determinista
├─ reports/            informes por corrida (sólo se versiona example-run.json)
├─ thresholds.json     lo que rompe el build
├─ baseline.json       la última corrida bendecida
└─ src/
   ├─ main.ts          entrypoint ejecutable
   ├─ cli.ts           flags
   ├─ run.ts           runner: concurrencia, validación, agregados
   ├─ response-source.ts  fixtures ↔ API
   ├─ report.ts        tabla de consola + JSON
   ├─ baseline.ts      comparación y regresiones
   └─ graders/         un fichero por grader
```
