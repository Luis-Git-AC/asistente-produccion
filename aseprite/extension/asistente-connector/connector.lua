--[[
  connector.lua — extension de Aseprite que hace de puente con @asistente/mcp-aseprite.

  Aseprite actua como CLIENTE WebSocket; el servidor lo levanta Node. La extension se carga al
  abrir Aseprite, intenta conectar sola, y expone tres comandos en File > Scripts:

    Asistente: Connect     reconecta (util tras reiniciar el servidor Node)
    Asistente: Disconnect  corta la conexion
    Asistente: Status      muestra estado, puerto y peticiones servidas

  POR QUE UNA EXTENSION Y NO UN SCRIPT SUELTO

  Un script ejecutado desde File > Scripts termina en su ultima linea: sus locales quedan libres
  para el recolector y el callback `onreceive` deja de dispararse, dejando un socket abierto pero
  sordo (toda peticion acaba en timeout). Una extension vive toda la sesion de Aseprite, asi que
  no hace falta ningun truco para mantenerla viva.

  PROTOCOLO (deliberadamente sin JSON en la recepcion)

    recibe : "<id>\n<codigo lua>"        -- id en la primera linea, el resto es el script
    envia  : {"id":"...","ok":true,"result":"..."}
             {"id":"...","ok":false,"error":"..."}

  Aseprite NO trae libreria JSON, asi que no se usa `json.decode` para recibir ni `json.encode`
  para responder: partir por la primera linea no puede fallar a medias, y la respuesta se
  construye a mano con un escapador minimo.

  REGLA QUE NO SE PUEDE ROMPER

  Nada de `app.alert`, `Dialog:show()` modal ni `app.command` sin `ui = false` dentro del codigo
  que se ejecute aqui: bloquean el hilo de UI de Aseprite y con el, este socket.

  Instalacion: ver aseprite/README.md
]]

local DEFAULT_PORT = 3001

-- `os` esta parcialmente restringido en el sandbox Lua de Aseprite segun la version, asi que
-- os.getenv se consulta bajo pcall: si no esta disponible se cae al puerto por defecto.
local function resolvePort()
  local ok, value = pcall(function()
    return os and os.getenv and os.getenv("ASEPRITE_WS_PORT")
  end)
  if ok and value then
    return tonumber(value) or DEFAULT_PORT
  end
  return DEFAULT_PORT
end

local PORT = resolvePort()
local URL = "ws://127.0.0.1:" .. PORT

local ws = nil
local isOpen = false
local requests = 0

--- Escapa una cadena para meterla en un literal JSON. Sustituye a json.encode.
local function jsonEscape(value)
  local out = tostring(value)
  out = out:gsub("\\", "\\\\")
  out = out:gsub('"', '\\"')
  out = out:gsub("\n", "\\n")
  out = out:gsub("\r", "\\r")
  out = out:gsub("\t", "\\t")
  -- Cualquier control char restante fuera: romperia el JSON del otro lado.
  out = out:gsub("%c", "")
  return out
end

local function respond(id, ok, payload)
  if ws == nil then return end
  local message
  if ok then
    message = '{"id":"' .. jsonEscape(id) .. '","ok":true,"result":"' .. jsonEscape(payload) .. '"}'
  else
    message = '{"id":"' .. jsonEscape(id) .. '","ok":false,"error":"' .. jsonEscape(payload) .. '"}'
  end
  pcall(function() ws:sendText(message) end)
end

--- Ejecuta el Lua recibido y devuelve (ok, textoResultado).
-- load+pcall para que un error de sintaxis o de runtime vuelva como string diagnosticable
-- en vez de romper la extension.
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

local function handle(data)
  local text = tostring(data)

  -- Sobre = primera linea el id, el resto el codigo. Sin parseo que pueda fallar a medias.
  local id, code = text:match("^([^\n]+)\n(.*)$")

  if id == nil then
    -- Diagnostico util en vez de un "ignorado" mudo: dice QUE llego y por que no vale.
    print("[asistente] sobre invalido (" .. #text .. " bytes): " .. text:sub(1, 120))
    return
  end

  if code == nil or code == "" then
    respond(id, false, "el sobre no traia codigo Lua tras la primera linea")
    return
  end

  requests = requests + 1

  local ok, payload = runLua(code)
  if ok then
    print("[asistente] peticion " .. requests .. " OK")
  else
    print("[asistente] peticion " .. requests .. " ERROR: " .. tostring(payload))
  end
  respond(id, ok, payload)
end

local function connect()
  if WebSocket == nil then
    print("[asistente] ERROR: esta version de Aseprite no expone la API WebSocket (requiere v1.3+).")
    return
  end

  -- Cierra cualquier socket anterior: sin esto, reconectar deja clientes zombis en el mismo
  -- puerto y el servidor no sabe a cual responder.
  if ws ~= nil then
    pcall(function() ws:close() end)
    ws = nil
    isOpen = false
  end

  ws = WebSocket{
    url = URL,
    deflate = false,
    onreceive = function(messageType, data)
      if messageType == WebSocketMessageType.TEXT then
        handle(data)
      elseif messageType == WebSocketMessageType.OPEN then
        isOpen = true
        print("[asistente] conectado a " .. URL)
      elseif messageType == WebSocketMessageType.CLOSE then
        isOpen = false
        print("[asistente] desconectado. File > Scripts > Asistente: Connect para reconectar.")
      end
    end,
  }

  print("[asistente] conectando a " .. URL .. " ...")
  ws:connect()
end

local function disconnect()
  if ws ~= nil then
    pcall(function() ws:close() end)
    ws = nil
  end
  isOpen = false
  print("[asistente] desconectado por el usuario")
end

-- `init` y `exit` son globales que llama Aseprite al cargar y descargar la extension.
function init(plugin)
  plugin:newCommand{
    id = "AsistenteConnect",
    title = "Asistente: Connect",
    group = "file_scripts",
    onclick = connect,
  }
  plugin:newCommand{
    id = "AsistenteDisconnect",
    title = "Asistente: Disconnect",
    group = "file_scripts",
    onclick = disconnect,
  }
  plugin:newCommand{
    id = "AsistenteStatus",
    title = "Asistente: Status",
    group = "file_scripts",
    onclick = function()
      -- app.alert bloquea el hilo de UI, pero aqui es aceptable: lo abre el usuario a proposito
      -- y no hay ninguna peticion en vuelo mientras lo lee.
      app.alert{
        title = "Asistente — connector",
        text = {
          "URL: " .. URL,
          "Estado: " .. (isOpen and "conectado" or "desconectado"),
          "Peticiones servidas: " .. requests,
        },
      }
    end,
  }

  -- Autoconexion al arrancar Aseprite. Si el servidor Node aun no esta levantado esto falla
  -- en silencio, y se reconecta a mano con "Asistente: Connect".
  connect()
end

function exit(plugin)
  disconnect()
end
