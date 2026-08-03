import clsx from "clsx";
import styles from "./App.module.css";
import { CostPanel } from "./components/CostPanel/CostPanel.js";
import { ErrorState } from "./components/ErrorState/ErrorState.js";
import { Panel } from "./components/Panel/Panel.js";
import { PromptForm } from "./components/PromptForm/PromptForm.js";
import { SpecStream } from "./components/SpecStream/SpecStream.js";
import { SpritePreview } from "./components/SpritePreview/SpritePreview.js";
import { StageTimeline } from "./components/StageTimeline/StageTimeline.js";
import { ThemeToggle } from "./components/ThemeToggle/ThemeToggle.js";
import { useGeneration } from "./hooks/useGeneration.js";

const STATUS_TEXT: Record<string, string> = {
  idle: "listo",
  streaming: "generando especificación",
  validating: "validando",
  rendering: "renderizando en Aseprite",
  done: "completado",
  error: "error",
};

export function App() {
  const { state, isBusy, generate, cancel, reset } = useGeneration();
  const hasStarted = state.status !== "idle";

  const retry = (): void => {
    if (state.prompt !== "") void generate(state.prompt, state.model);
  };

  return (
    <div className={styles.shell}>
      <a className={styles.skipLink} href="#contenido">
        Saltar al contenido
      </a>

      <header className={styles.header}>
        <div className={styles.brand}>
          <span className={styles.brandTitle}>Asistente de producción 2D</span>
          <span className={styles.brandSub}>sprite spec → aseprite</span>
        </div>
        <div className={styles.headerActions}>
          <ThemeToggle />
        </div>
      </header>

      <main className={styles.main} id="contenido">
        <div className={styles.intro}>
          <h1 className={styles.title}>Describe un sprite. Recíbelo en Aseprite.</h1>
          <p className={styles.subtitle}>
            El modelo devuelve una especificación validada contra schema y un MCP propio la
            materializa en un <code>.aseprite</code> real, con su spritesheet listo para Unity.
          </p>
        </div>

        <PromptForm
          onSubmit={(prompt, model) => {
            void generate(prompt, model);
          }}
          onCancel={cancel}
          isBusy={isBusy}
        />

        {/* Estado textual para lectores de pantalla: el timeline es visual. */}
        <p aria-live="polite" className="sr-only">
          {STATUS_TEXT[state.status] ?? state.status}
        </p>

        {state.error !== null && (
          <ErrorState error={state.error} onRetry={retry} onDismiss={reset} />
        )}

        {hasStarted && (
          <>
            <div className={clsx(styles.timelineWrap, styles.appear)}>
              <StageTimeline stages={state.stages} status={state.status} />
            </div>

            <div className={styles.split}>
              <Panel
                title="Especificación"
                flush
                aside={
                  state.spec !== null
                    ? `${String(state.spec.frames.length)} frames · ${String(state.spec.palette.length)} colores`
                    : state.specText !== ""
                      ? `${String(state.specText.length)} car.`
                      : undefined
                }
              >
                <SpecStream text={state.specText} isStreaming={state.status === "streaming"} />
              </Panel>

              <Panel
                title="Vista previa"
                flush
                aside={
                  state.renderProgress !== null && state.status === "rendering"
                    ? `${String(state.renderProgress.frame)}/${String(state.renderProgress.total)}`
                    : undefined
                }
              >
                {state.spec !== null ? (
                  <SpritePreview
                    spec={state.spec}
                    spritesheetUrl={state.result?.spritesheetUrl ?? null}
                  />
                ) : (
                  <p className={styles.placeholder}>
                    El sprite aparecerá cuando el spec esté validado.
                  </p>
                )}
              </Panel>

              <div className={styles.fullWidth}>
                <Panel title="Coste y tokens">
                  <CostPanel result={state.result} />
                </Panel>
              </div>
            </div>
          </>
        )}
      </main>
    </div>
  );
}
