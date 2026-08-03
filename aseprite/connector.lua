--[[
  connector.lua — puente entre Aseprite y el MCP server de @asistente/mcp-aseprite.

  Aseprite actúa como CLIENTE WebSocket; el servidor lo levanta Node. Este script se queda
  escuchando y ejecuta el Lua que recibe, devolviendo el resultado por el mismo socket.

  Protocolo (una línea JSON por mensaje):
    recibe  { "id": "<uuid>", "lua": "<código>" }
    devuelve { "id": "<uuid>", "ok": true,  "result": "<string>" }
             { "id": "<uuid>", "ok": false, "error":  "<mensaje real de Aseprite>" }

  Reglas de oro (romperlas cuelga el connector):
    - Nada de app.alert ni Dialog:show(): bloquean el hilo de UI y el socket deja de responder.
    - Todo app.command lleva ui=false.
    - Los errores se devuelven como mensaje, nunca se dejan propagar como error de Lua.

  Instalación y uso: ver aseprite/README.md
]]

local DEFAULT_PORT = 3001

-- `os` está parcialmente restringido en el sandbox Lua de Aseprite segun la version, asi que
-- os.getenv se consulta bajo pcall: si no esta disponible se cae al puerto por defecto en vez
-- de abortar el script con un error poco descriptivo.
local port = DEFAULT_PORT
local okEnv, envPort = pcall(function()
  return os and os.getenv and os.getenv("ASEPRITE_WS_PORT")
end)
if okEnv and envPort then
  port = tonumber(envPort) or DEFAULT_PORT
end

local url = "ws://127.0.0.1:" .. port

if WebSocket == nil then
  print("[asistente] ERROR: esta version de Aseprite no expone la API WebSocket (requiere v1.3+).")
  return
end

if json == nil then
  print("[asistente] ERROR: esta version de Aseprite no expone el modulo json (requiere v1.3+).")
  return
end

local ws
local connected = false

--- Ejecuta el Lua recibido y devuelve (ok, textoResultado).
-- Se usa load+pcall para que un error de sintaxis o de runtime vuelva como string
-- diagnosticable en vez de romper el connector.
local function runLua(code)
  local chunk, compileErr = load(code, "=[mcp]", "t")
  if chunk == nil then
    return false, "error de compilacion: " .. tostring(compileErr)
  end

  local ok, resultOrErr = pcall(chunk)
  if not ok then
    return false, tostring(resultOrErr)
  end

  if resultOrErr == nil then
    return true, "OK"
  end
  return true, tostring(resultOrErr)
end

local function respond(id, ok, payload)
  local message
  if ok then
    message = json.encode({ id = id, ok = true, result = payload })
  else
    message = json.encode({ id = id, ok = false, error = payload })
  end
  ws:sendText(message)
end

local function onMessage(messageType, data)
  if messageType == WebSocketMessageType.OPEN then
    connected = true
    print("[asistente] conectado a " .. url)
    return
  end

  if messageType == WebSocketMessageType.CLOSE then
    connected = false
    print("[asistente] desconectado. Relanza el script para volver a conectar.")
    return
  end

  if messageType ~= WebSocketMessageType.TEXT then
    return
  end

  local decoded
  local decodeOk = pcall(function() decoded = json.decode(data) end)
  if not decodeOk or type(decoded) ~= "table" or decoded.id == nil then
    print("[asistente] mensaje ignorado: no es un sobre {id, lua} valido")
    return
  end

  if type(decoded.lua) ~= "string" then
    respond(decoded.id, false, "el campo 'lua' es obligatorio y debe ser una cadena")
    return
  end

  local ok, payload = runLua(decoded.lua)
  if ok then
    print("[asistente] " .. tostring(decoded.id) .. " OK")
  else
    print("[asistente] " .. tostring(decoded.id) .. " ERROR: " .. tostring(payload))
  end
  respond(decoded.id, ok, payload)
end

ws = WebSocket{
  url = url,
  deflate = false,
  onreceive = onMessage,
}

print("[asistente] conectando a " .. url .. " ...")
ws:connect()

if not connected then
  print("[asistente] si no aparece 'conectado' en un segundo, arranca antes el servidor Node:")
  print("[asistente]   npm run smoke -w @asistente/mcp-aseprite")
end
