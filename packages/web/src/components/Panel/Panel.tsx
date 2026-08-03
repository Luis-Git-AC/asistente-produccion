import clsx from "clsx";
import type { ReactNode } from "react";
import styles from "./Panel.module.css";

interface PanelProps {
  title: string;
  /** Contenido a la derecha de la cabecera: contadores, controles, estado. */
  aside?: ReactNode;
  children: ReactNode;
  /** Quita el padding del cuerpo, para contenidos que gestionan el suyo (canvas, scroll). */
  flush?: boolean;
  className?: string;
}

/** Superficie con cabecera. Es el contenedor base de todos los paneles de la pantalla. */
export function Panel({ title, aside, children, flush = false, className }: PanelProps) {
  return (
    <section className={clsx(styles.panel, className)} aria-label={title}>
      <header className={styles.header}>
        <h2 className={styles.title}>{title}</h2>
        {aside !== undefined && <div className={styles.aside}>{aside}</div>}
      </header>
      <div className={clsx(styles.body, flush && styles.bodyFlush)}>{children}</div>
    </section>
  );
}
