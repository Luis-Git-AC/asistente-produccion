import styles from "./WindowPicker.module.css";
import { WINDOWS, type WindowValue } from "./useDashboard.js";

/**
 * Selector de ventana temporal.
 *
 * Es un grupo de radios de verdad, no botones: las opciones son excluyentes y así el teclado y
 * los lectores de pantalla lo entienden sin ayuda. El aspecto de pastilla lo pone el CSS.
 */
export function WindowPicker({
  value,
  onChange,
}: {
  value: WindowValue;
  onChange: (value: WindowValue) => void;
}) {
  return (
    <fieldset className={styles.group}>
      <legend className={styles.legend}>Ventana</legend>
      {WINDOWS.map((window) => (
        <label key={window.value} className={styles.option}>
          <input
            type="radio"
            name="dashboard-window"
            value={window.value}
            checked={value === window.value}
            onChange={() => {
              onChange(window.value);
            }}
            className={styles.input}
          />
          <span className={styles.pill}>{window.label}</span>
        </label>
      ))}
    </fieldset>
  );
}
