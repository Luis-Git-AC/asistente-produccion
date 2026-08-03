import { useCallback, useReducer, useRef } from "react";
import type {
  DonePayload,
  ErrorPayload,
  GenerationStage,
  ModelId,
  SpriteSpec,
  SseEvent,
} from "@asistente/shared";
import { SseClientError, streamGeneration } from "../lib/sse.js";

/**
 * Máquina de estados explícita de una generación.
 *
 * Un único `status` en vez de `isLoading` + `hasError` + `isDone` coordinándose entre sí: con
 * booleanos sueltos son representables estados imposibles (cargando Y con error a la vez) y la UI
 * acaba llena de condiciones defensivas. Aquí el estado imposible no se puede escribir.
 */

export type GenerationStatus =
  | "idle"
  | "streaming"
  | "validating"
  | "rendering"
  | "done"
  | "error";

/** Una etapa observada, con su latencia acumulada al completarse. */
export interface StageRecord {
  stage: GenerationStage;
  elapsedMs: number;
}

export interface GenerationState {
  status: GenerationStatus;
  prompt: string;
  /** Modelo primario pedido. El servido puede diferir si saltó el fallback. */
  model: ModelId;
  /** Texto del spec según llega, para el panel de streaming. */
  specText: string;
  spec: SpriteSpec | null;
  stages: StageRecord[];
  renderProgress: { frame: number; total: number } | null;
  result: DonePayload | null;
  error: ErrorPayload | null;
}

const INITIAL_STATE: GenerationState = {
  status: "idle",
  prompt: "",
  model: "claude-opus-5",
  specText: "",
  spec: null,
  stages: [],
  renderProgress: null,
  result: null,
  error: null,
};

type Action =
  | { type: "start"; prompt: string; model: ModelId }
  | { type: "sse"; event: SseEvent }
  | { type: "failed"; error: ErrorPayload }
  | { type: "reset" };

/** Etapa del backend -> estado de la máquina. `cache` no cambia de estado: es instantánea. */
const STATUS_BY_STAGE: Partial<Record<GenerationStage, GenerationStatus>> = {
  llm: "streaming",
  validate: "validating",
  render: "rendering",
  export: "rendering",
};

function reducer(state: GenerationState, action: Action): GenerationState {
  switch (action.type) {
    case "start":
      return { ...INITIAL_STATE, status: "streaming", prompt: action.prompt, model: action.model };

    case "reset":
      return INITIAL_STATE;

    case "failed":
      return { ...state, status: "error", error: action.error };

    case "sse": {
      const { event } = action;
      switch (event.type) {
        case "stage":
          return {
            ...state,
            status: STATUS_BY_STAGE[event.data.stage] ?? state.status,
            stages: [...state.stages, { stage: event.data.stage, elapsedMs: event.data.elapsedMs }],
          };

        case "spec_delta":
          return { ...state, specText: state.specText + event.data.text };

        case "spec_final":
          return {
            ...state,
            spec: event.data.spec,
            // El spec definitivo sustituye al texto parcial: si el modelo lo sirvió desde caché
            // no hubo deltas, y sin esto el panel se quedaría vacío.
            specText: JSON.stringify(event.data.spec, null, 2),
          };

        case "render_progress":
          return { ...state, renderProgress: event.data };

        case "done":
          return { ...state, status: "done", result: event.data };

        case "error":
          return { ...state, status: "error", error: event.data };
      }
    }
  }
}

/** Traduce un fallo de transporte a la misma forma que un `error` del servidor. */
function toErrorPayload(error: unknown): ErrorPayload {
  if (error instanceof SseClientError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.code === "network" || error.code === "http_error",
    };
  }
  return {
    code: "unknown",
    message: error instanceof Error ? error.message : String(error),
    retryable: true,
  };
}

export interface UseGenerationResult {
  state: GenerationState;
  isBusy: boolean;
  generate: (prompt: string, model?: ModelId) => Promise<void>;
  cancel: () => void;
  reset: () => void;
}

export function useGeneration(): UseGenerationResult {
  const [state, dispatch] = useReducer(reducer, INITIAL_STATE);
  const abortRef = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  const reset = useCallback(() => {
    cancel();
    dispatch({ type: "reset" });
  }, [cancel]);

  const generate = useCallback(
    async (prompt: string, model: ModelId = "claude-opus-5"): Promise<void> => {
      // Una generación en curso se cancela antes de empezar otra: dos streams a la vez pintarían
      // deltas entremezclados en el mismo panel.
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      dispatch({ type: "start", prompt, model });

      try {
        await streamGeneration({
          prompt,
          model,
          signal: controller.signal,
          onEvent: (event) => {
            dispatch({ type: "sse", event });
          },
        });
      } catch (error) {
        // Un abort deliberado no es un fallo que mostrar: lo provocó el propio usuario.
        if (error instanceof SseClientError && error.code === "aborted") return;
        dispatch({ type: "failed", error: toErrorPayload(error) });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [],
  );

  const isBusy =
    state.status === "streaming" || state.status === "validating" || state.status === "rendering";

  return { state, isBusy, generate, cancel, reset };
}
