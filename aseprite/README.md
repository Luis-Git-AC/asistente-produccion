# Connector de Aseprite

`connector.lua` es un cliente WebSocket que corre **dentro** de Aseprite y ejecuta el Lua que le
envía el MCP server. Sin él, el paquete `@asistente/mcp-aseprite` no puede generar nada.

El sentido de la conexión importa: la API Lua de Aseprite sólo trae **cliente** WebSocket, así que
**Node levanta el servidor y Aseprite se conecta a él**. Consecuencia práctica: arranca siempre el
lado Node antes de ejecutar el script en Aseprite.

## Requisitos

- Aseprite **v1.3 o superior** (las versiones anteriores no exponen `WebSocket` ni `json`).
- Node 22+ con las dependencias del monorepo instaladas (`npm install` en la raíz).

## Instalación en pasos

1. **Localiza la carpeta de scripts de Aseprite.** En Aseprite: `File > Scripts > Open Scripts Folder`.
   Rutas habituales:
   - Windows: `%APPDATA%\Aseprite\scripts`
   - macOS: `~/Library/Application Support/Aseprite/scripts`
   - Linux: `~/.config/aseprite/scripts`

2. **Copia `aseprite/connector.lua`** de este repositorio a esa carpeta.

3. **Refresca la lista de scripts** en Aseprite: `File > Scripts > Rescan Scripts Folder`.
   El script aparecerá como `connector`.

4. **Arranca el lado Node primero.** Desde la raíz del repo:

   ```bash
   npm run smoke -w @asistente/mcp-aseprite
   ```

   Debe quedarse esperando con `Escuchando en ws://127.0.0.1:3001 — esperando al connector...`.

5. **Ejecuta el script en Aseprite**: `File > Scripts > connector`.
   En la consola de Aseprite (`View > Console`) verás `[asistente] conectado a ws://127.0.0.1:3001`,
   y el comando del paso 4 terminará imprimiendo la versión de Aseprite y saliendo con código 0.

## Relanzar el connector

El connector **no se reconecta solo**: la API Lua de Aseprite no tiene temporizadores, así que si
el servidor Node se cae o reinicias Aseprite, hay que volver a ejecutar `File > Scripts > connector`.
El lado Node sí acepta que el connector vuelva a conectarse sin reiniciar el servidor.

## Cambiar el puerto

Por defecto es el `3001`. Para cambiarlo, define `ASEPRITE_WS_PORT` **en los dos lados**:

- Node: variable de entorno antes de arrancar (ver `.env.example`).
- Aseprite: la misma variable en el entorno desde el que lanzas Aseprite. Si tu sistema no la
  propaga a la app, edita `DEFAULT_PORT` en la primera línea de `connector.lua`.

## Diagnóstico

| Síntoma | Causa probable | Solución |
|---|---|---|
| `El connector no se conectó en 15 s` | El script no está corriendo en Aseprite | Paso 5. Comprueba la consola de Aseprite |
| `ERROR: esta version de Aseprite no expone la API WebSocket` | Aseprite < 1.3 | Actualizar Aseprite |
| `No se pudo abrir el puerto 3001` | Ya hay un puente corriendo | Cierra el otro proceso o cambia `ASEPRITE_WS_PORT` |
| Aseprite se queda congelado y el socket no responde | Algún script abrió un diálogo modal | Cierra el diálogo. Nunca uses `app.alert`, `Dialog:show()` ni `app.command` sin `ui=false` |
| `Aseprite no respondió en 30000 ms` | Lo mismo que arriba, o un script muy lento | Revisa la consola de Aseprite |

## Nota de seguridad

El connector ejecuta el Lua que recibe por el socket. El servidor escucha **sólo en `127.0.0.1`**,
así que no es alcanzable desde la red, pero cualquier proceso local puede conectarse: no lo dejes
corriendo en una máquina compartida con usuarios en los que no confíes.
