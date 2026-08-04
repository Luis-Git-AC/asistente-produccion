import { useEffect, useState } from "react";

/**
 * Enrutado mínimo por hash. Dos vistas no justifican una dependencia de router.
 *
 * Se usa el hash y no el pathname a propósito: con `history.pushState` haría falta que el
 * servidor devolviera `index.html` para cualquier ruta, y este proyecto sirve la web como
 * estáticos. Con hash, recargar `/#/panel` funciona sin tocar el servidor.
 *
 * El query string se conserva intacto: es donde vive la ventana del dashboard.
 */

export type Route = "generar" | "panel";

function parse(hash: string): Route {
  return hash.replace(/^#\/?/u, "") === "panel" ? "panel" : "generar";
}

export function useHashRoute(): [Route, (route: Route) => void] {
  const [route, setRoute] = useState<Route>(() => parse(globalThis.location.hash));

  useEffect(() => {
    const onHashChange = (): void => {
      setRoute(parse(globalThis.location.hash));
    };
    globalThis.addEventListener("hashchange", onHashChange);
    return () => {
      globalThis.removeEventListener("hashchange", onHashChange);
    };
  }, []);

  const navigate = (next: Route): void => {
    // `location.hash` dispara `hashchange`, que es quien actualiza el estado: una sola fuente.
    globalThis.location.hash = next === "panel" ? "#/panel" : "#/";
  };

  return [route, navigate];
}
