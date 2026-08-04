import { useCallback, useEffect, useRef, useState } from "react";
import type { DashboardPayload } from "@asistente/shared";

/**
 * Carga del panel: una sola petición por ventana.
 *
 * El servidor devuelve KPIs, ventana anterior, las cuatro series, alertas y tabla en un único
 * `GET /api/dashboard`. Cinco endpoints darían cinco estados de carga que coordinar y cinco
 * formas de quedarse a medias.
 */

/** Ventanas ofrecidas. El valor viaja tal cual en la URL y en el query param del servidor. */
export const WINDOWS = [
  { value: "1h", label: "1 h" },
  { value: "24h", label: "24 h" },
  { value: "7d", label: "7 d" },
  { value: "30d", label: "30 d" },
] as const;

export type WindowValue = (typeof WINDOWS)[number]["value"];

const DEFAULT_WINDOW: WindowValue = "24h";

function isWindowValue(value: string | null): value is WindowValue {
  return value !== null && WINDOWS.some((window) => window.value === value);
}

/** Lee la ventana de la URL. Un enlace al panel debe abrir exactamente lo que se compartió. */
export function readWindowFromLocation(search: string): WindowValue {
  const value = new URLSearchParams(search).get("window");
  return isWindowValue(value) ? value : DEFAULT_WINDOW;
}

export type DashboardStatus = "loading" | "ready" | "error";

export interface UseDashboardResult {
  status: DashboardStatus;
  data: DashboardPayload | null;
  error: string | null;
  window: WindowValue;
  setWindow: (value: WindowValue) => void;
  reload: () => void;
}

export function useDashboard(baseUrl = ""): UseDashboardResult {
  const [window_, setWindowState] = useState<WindowValue>(() =>
    readWindowFromLocation(globalThis.location.search),
  );
  const [data, setData] = useState<DashboardPayload | null>(null);
  const [status, setStatus] = useState<DashboardStatus>("loading");
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const abortRef = useRef<AbortController | null>(null);

  // La ventana vive en la URL: recargar o compartir el enlace conserva la vista.
  const setWindow = useCallback((value: WindowValue) => {
    setWindowState(value);
    const url = new URL(globalThis.location.href);
    url.searchParams.set("window", value);
    globalThis.history.replaceState(null, "", url);
  }, []);

  const reload = useCallback(() => {
    setNonce((value) => value + 1);
  }, []);

  useEffect(() => {
    // Cambiar de ventana rápido deja peticiones en vuelo: sin abortar, la lenta pisaría a la
    // rápida y el panel mostraría una ventana distinta de la seleccionada.
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;

    setStatus((current) => (current === "ready" ? current : "loading"));

    void (async () => {
      try {
        const response = await fetch(`${baseUrl}/api/dashboard?window=${window_}`, {
          signal: controller.signal,
          headers: { accept: "application/json" },
        });
        if (!response.ok) {
          throw new Error(`El servidor respondió ${String(response.status)}.`);
        }
        setData((await response.json()) as DashboardPayload);
        setError(null);
        setStatus("ready");
      } catch (cause) {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : String(cause));
        setStatus("error");
      }
    })();

    return () => {
      controller.abort();
    };
  }, [baseUrl, window_, nonce]);

  return { status, data, error, window: window_, setWindow, reload };
}
