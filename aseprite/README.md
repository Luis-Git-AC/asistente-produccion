# Connector de Aseprite

`extension/asistente-connector/` es una **extensión de Aseprite** que hace de puente entre
Aseprite y el MCP server: recibe código Lua por WebSocket, lo ejecuta y devuelve el resultado.
Sin ella, `@asistente/mcp-aseprite` no puede generar nada.

Dos cosas contraintuitivas que conviene tener claras antes de empezar:

- **Aseprite es el cliente WebSocket**, no el servidor: su API Lua sólo trae cliente. Node levanta
  el servidor, así que **arranca siempre el lado Node primero**.
- **Es una extensión, no un script.** Un script lanzado desde `File > Scripts` termina en su
  última línea y su callback `onreceive` deja de dispararse: el socket queda abierto pero sordo y
  toda petición acaba en timeout. Una extensión vive toda la sesión de Aseprite.

## Requisitos

- Aseprite **v1.3 o superior** (las anteriores no exponen `WebSocket` en la API Lua).
- Node 22+ con las dependencias del monorepo instaladas (`npm install` en la raíz).

## Instalación

Dos vías. La primera es más cómoda mientras se desarrolla.

### Opción A — copiar la carpeta (recomendada en desarrollo)

```powershell
$dest = "$env:APPDATA\Aseprite\extensions\asistente-connector"
New-Item -ItemType Directory -Force -Path $dest | Out-Null
Copy-Item -Force aseprite\extension\asistente-connector\* $dest
```

Reinicia Aseprite. Al reinstalar tras un cambio, repite el copy y reinicia.

### Opción B — paquete instalable

```powershell
.\aseprite\pack-extension.ps1
```

Genera `aseprite\asistente-connector.aseprite-extension`. En Aseprite:
`Edit > Preferences > Extensions > Add Extension` → selecciónalo → reinicia.

## Uso

Al abrir Aseprite, la extensión **intenta conectarse sola**. Si el lado Node no estaba levantado,
falla en silencio y basta con reconectar a mano.

Los comandos aparecen en el menú **File**, justo **debajo** del submenú `Scripts` (no dentro de
él: `group = "file_scripts"` los pone como hermanos del submenú, no como hijos):

| Comando | Para qué |
|---|---|
| `File > Asistente: Connect` | Reconectar. **Es el que necesitas tras reiniciar el servidor Node.** |
| `File > Asistente: Disconnect` | Cortar la conexión |
| `File > Asistente: Status` | Ver estado, puerto y número de peticiones servidas |

> Además verás `File > Scripts > asistente-connector > connector`. **Ignóralo.** Aseprite lista el
> `.lua` de toda extensión como script ejecutable, pero este sólo define `init`/`exit`, así que
> ejecutarlo a mano no hace nada. Los comandos de arriba son la vía correcta.

**La primera vez, Aseprite mostrará un diálogo de seguridad** porque la extensión abre una
conexión de red. Es esperado: marca la casilla de dar confianza y acepta. Si lo cancelas, el
connector no puede conectarse. Para no volver a verlo:
`Edit > Preferences > Scripts > Allow scripts to access files and network`.

**La consola de Aseprite no está en `View`**: se abre sola en cuanto la extensión imprime algo.

## Comprobación

Desde la raíz del repo, con Aseprite abierto:

```bash
npm run smoke -w @asistente/mcp-aseprite
```

Si el connector estaba desconectado, ejecuta `File > Asistente: Connect`.
Debe terminar con `OK — Aseprite responde. app.version = 1.3.x`.

Para validar la cadena completa (MCP → Lua → Aseprite) **sin gastar API**:

```bash
npm run render:example -w @asistente/server
```

Genera un icono de gema de 8×8 en `output/`.

## El ciclo que vas a repetir

Cada vez que reinicies el lado Node (`smoke`, `render:example`, `dev`), el puente WebSocket es
nuevo y el connector se queda desconectado. **Reconecta con `File > Asistente: Connect`.**
No hace falta reiniciar Aseprite.

## Cambiar el puerto

Por defecto es el `3001`. Para cambiarlo, define `ASEPRITE_WS_PORT` **en los dos lados**:

- Node: variable de entorno antes de arrancar (ver `.env.example`).
- Aseprite: la misma variable en el entorno desde el que lanzas Aseprite. Si tu sistema no la
  propaga a la app, edita `DEFAULT_PORT` en la cabecera de `connector.lua`.

## Diagnóstico

| Síntoma | Causa probable | Solución |
|---|---|---|
| `El connector no está conectado` | El puente Node es nuevo | `File > Asistente: Connect` |
| No aparecen los comandos en el menú `File` | La extensión no cargó | Reinstala y **reinicia Aseprite**; comprueba `Edit > Preferences > Extensions` |
| `ERROR: ... no expone la API WebSocket` | Aseprite < 1.3 | Actualizar Aseprite |
| `No se pudo abrir el puerto 3001` | Ya hay otro puente corriendo | Cierra el otro proceso o cambia `ASEPRITE_WS_PORT` |
| `Aseprite no respondió en 30000 ms` | Un diálogo modal está bloqueando la UI | Ciérralo. Nunca uses `app.alert`, `Dialog:show()` modal ni `app.command` sin `ui = false` |
| `sobre invalido (N bytes)` en la consola | Desajuste de protocolo entre Node y la extensión | Reinstala la extensión: los dos lados deben ir a la par |

## Protocolo

Deliberadamente **sin JSON en la recepción**, porque Aseprite no trae librería JSON:

```
Node -> Aseprite :  "<id>\n<codigo lua>"
Aseprite -> Node :  {"id":"...","ok":true,"result":"..."}
                    {"id":"...","ok":false,"error":"..."}
```

Partir por la primera línea no puede fallar a medias. La respuesta se construye a mano con un
escapador mínimo; quien la parsea es Node, que sí tiene `JSON.parse` fiable.

## Nota de seguridad

La extensión ejecuta el Lua que recibe por el socket. El servidor escucha **sólo en `127.0.0.1`**,
así que no es alcanzable desde la red, pero cualquier proceso local puede conectarse: no la dejes
conectada en una máquina compartida con usuarios en los que no confíes. Usa
`Asistente: Disconnect` cuando termines.
