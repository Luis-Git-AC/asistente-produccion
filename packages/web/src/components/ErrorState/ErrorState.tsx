import type { ErrorPayload } from "@asistente/shared";
import styles from "./ErrorState.module.css";

interface ErrorStateProps {
  error: ErrorPayload;
  onRetry: () => void;
  onDismiss: () => void;
}

interface ErrorPresentation {
  title: string;
  action: string;
}

/**
 * Traduce el código de error a algo accionable.
 *
 * "Algo salió mal" no es un estado de error: el usuario tiene que saber si el problema está en
 * el modelo, en su prompt o en que Aseprite no está conectado, porque la acción es distinta
 * en cada caso.
 */
export function presentError(error: ErrorPayload): ErrorPresentation {
  // Aseprite / MCP: el problema está fuera del navegador.
  if (error.code === "mcp_not_connected" || /connector|Aseprite/iu.test(error.message)) {
    return {
      title: "Aseprite no está conectado",
      action:
        "Abre Aseprite y usa File > Asistente: Connect. El sprite no puede generarse sin el connector.",
    };
  }
  if (error.code === "mcp_spawn_failed") {
    return {
      title: "No se pudo arrancar el MCP",
      action: "Revisa la consola del servidor: el proceso de @asistente/mcp-aseprite no arrancó.",
    };
  }
  if (error.code === "mcp_tool_error") {
    return {
      title: "Aseprite rechazó el script",
      action: "El mensaje de abajo viene de Aseprite. Suele indicar el problema exacto.",
    };
  }

  // Modelo.
  if (error.code === "refusal") {
    return {
      title: "El modelo declinó la petición",
      action: "Reformula el prompt evitando temas que puedan activar los filtros de seguridad.",
    };
  }
  if (error.code === "invalid_spec") {
    return {
      title: "La especificación no validó",
      action:
        "El modelo devolvió un spec que rompe algún invariante. Reintentar suele bastar; si insiste, concreta más las restricciones.",
    };
  }
  if (error.code === "retries_exhausted" || error.code === "simulated_failure") {
    return {
      title: "El modelo no respondió",
      action: "Se agotaron los reintentos en toda la cadena de modelos. Prueba de nuevo en un momento.",
    };
  }
  if (error.code === "empty_response") {
    return {
      title: "Respuesta vacía del modelo",
      action: "Reintenta. Si se repite, acorta el prompt.",
    };
  }

  // Transporte / red.
  if (error.code === "network" || error.code === "http_error") {
    return {
      title: "No se pudo contactar con el servidor",
      action: "Comprueba que el backend sigue en marcha (npm run dev -w @asistente/server).",
    };
  }
  if (error.code === "invalid_prompt") {
    return { title: "Prompt no válido", action: "Escribe una descripción antes de generar." };
  }

  return {
    title: "Error inesperado",
    action: "Revisa la consola del servidor para el detalle completo.",
  };
}

export function ErrorState({ error, onRetry, onDismiss }: ErrorStateProps) {
  const { title, action } = presentError(error);

  return (
    <div className={styles.container} role="alert">
      <div className={styles.head}>
        <span className={styles.title}>{title}</span>
        <span className={styles.code}>{error.code}</span>
      </div>

      <p className={styles.message}>{error.message}</p>

      <div className={styles.action}>
        <span className={styles.actionIcon} aria-hidden="true">
          →
        </span>
        <span>{action}</span>
      </div>

      <div className={styles.actions}>
        {error.retryable && (
          <button type="button" className={styles.retry} onClick={onRetry}>
            Reintentar
          </button>
        )}
        <button type="button" className={styles.dismiss} onClick={onDismiss}>
          Descartar
        </button>
      </div>
    </div>
  );
}
