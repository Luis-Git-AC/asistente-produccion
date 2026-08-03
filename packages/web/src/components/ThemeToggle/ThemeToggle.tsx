import { useEffect, useState } from "react";
import styles from "./ThemeToggle.module.css";

type Theme = "light" | "dark";
const STORAGE_KEY = "asistente:theme";

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    // Modo privado o storage bloqueado: no es motivo para romper la app.
    return null;
  }
}

function systemTheme(): Theme {
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => readStoredTheme() ?? systemTheme());

  useEffect(() => {
    document.documentElement.dataset["theme"] = theme;
    try {
      localStorage.setItem(STORAGE_KEY, theme);
    } catch {
      /* sin persistencia, pero el tema sigue aplicándose en esta sesión */
    }
  }, [theme]);

  const next: Theme = theme === "dark" ? "light" : "dark";

  return (
    <button
      type="button"
      className={styles.toggle}
      onClick={() => {
        setTheme(next);
      }}
      aria-label={`Cambiar a tema ${next === "dark" ? "oscuro" : "claro"}`}
      title={`Tema ${theme === "dark" ? "oscuro" : "claro"}`}
    >
      <span aria-hidden="true">{theme === "dark" ? "◑" : "◐"}</span>
    </button>
  );
}
