import clsx from "clsx";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import { MODEL_IDS, MODEL_PRICING, type ModelId } from "@asistente/shared";
import styles from "./PromptForm.module.css";

/** Ejemplos que cubren los tres tipos de asset del alcance mínimo. */
const EXAMPLES = [
  { label: "gema", prompt: "un icono de gema azul de 16x16, 5 colores, con brillo especular" },
  {
    label: "caminar",
    prompt:
      "un caballero de 32x32 con ciclo de caminata de 6 frames, paleta de 8 colores, silueta legible",
  },
  {
    label: "tileset",
    prompt: "un tileset de hierba de 16x16 con 4 variaciones, paleta de 6 colores, sin dithering",
  },
  {
    label: "poción",
    prompt: "un icono de poción de vida de 16x16, exactamente 5 colores, estilo RPG",
  },
] as const;

const MAX_LENGTH = 4000;

interface PromptFormProps {
  onSubmit: (prompt: string, model: ModelId) => void;
  onCancel: () => void;
  isBusy: boolean;
}

/** `claude-opus-5` -> `opus-5`. El prefijo es ruido cuando todos lo comparten. */
function shortName(model: ModelId): string {
  return model.replace(/^claude-/u, "");
}

export function PromptForm({ onSubmit, onCancel, isBusy }: PromptFormProps) {
  const [value, setValue] = useState("");
  const [model, setModel] = useState<ModelId>("claude-opus-5");
  const [touched, setTouched] = useState(false);
  const textareaId = useId();
  const modelId = useId();
  const errorId = useId();

  const trimmed = value.trim();
  const isEmpty = trimmed === "";
  const isTooLong = trimmed.length > MAX_LENGTH;
  const validationError = isTooLong
    ? `El prompt no puede superar los ${String(MAX_LENGTH)} caracteres.`
    : null;

  const submit = (): void => {
    setTouched(true);
    if (isEmpty || validationError !== null || isBusy) return;
    onSubmit(trimmed, model);
  };

  const handleSubmit = (event: FormEvent): void => {
    event.preventDefault();
    submit();
  };

  // Cmd/Ctrl+Enter envía desde el textarea, donde Enter significa salto de línea.
  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
      event.preventDefault();
      submit();
    }
  };

  return (
    <form className={styles.form} onSubmit={handleSubmit}>
      <div>
        <label className={styles.label} htmlFor={textareaId}>
          Describe el sprite
        </label>
        <textarea
          id={textareaId}
          className={styles.textarea}
          value={value}
          onChange={(event) => {
            setValue(event.target.value);
          }}
          onBlur={() => {
            setTouched(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder="un icono de poción de vida de 16x16, exactamente 5 colores, estilo RPG"
          disabled={isBusy}
          aria-invalid={touched && validationError !== null}
          aria-describedby={validationError !== null ? errorId : undefined}
          rows={3}
        />
        {touched && validationError !== null && (
          <span className={styles.fieldError} id={errorId} role="alert">
            {validationError}
          </span>
        )}
      </div>

      <div className={styles.examples}>
        <span className={styles.examplesLabel} id="ejemplos">
          Ejemplos
        </span>
        {EXAMPLES.map((example) => (
          <button
            key={example.label}
            type="button"
            className={styles.chip}
            onClick={() => {
              setValue(example.prompt);
            }}
            disabled={isBusy}
          >
            {example.label}
          </button>
        ))}
      </div>

      <div className={styles.actions}>
        <div className={styles.modelField}>
          <label className={styles.fieldLabel} htmlFor={modelId}>
            Modelo
          </label>
          <select
            id={modelId}
            className={styles.select}
            value={model}
            onChange={(event) => {
              setModel(event.target.value as ModelId);
            }}
            disabled={isBusy}
          >
            {MODEL_IDS.map((id) => (
              <option key={id} value={id}>
                {shortName(id)} · ${String(MODEL_PRICING[id].inputPerMTok)}/$
                {String(MODEL_PRICING[id].outputPerMTok)} MTok
              </option>
            ))}
          </select>
        </div>

        <button
          type="submit"
          className={clsx(styles.button, styles.primary)}
          disabled={isBusy || isEmpty}
        >
          {isBusy && <span className={styles.spinner} aria-hidden="true" />}
          {isBusy ? "Generando…" : "Generar sprite"}
        </button>

        {isBusy && (
          <button
            type="button"
            className={clsx(styles.button, styles.secondary)}
            onClick={onCancel}
          >
            Cancelar
          </button>
        )}

        <span className={styles.hint}>
          <kbd className={styles.kbd}>Ctrl</kbd> + <kbd className={styles.kbd}>Enter</kbd>
        </span>
      </div>
    </form>
  );
}
