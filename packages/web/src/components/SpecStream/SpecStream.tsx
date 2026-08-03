import { Fragment, useEffect, useRef, type ReactNode } from "react";
import styles from "./SpecStream.module.css";

interface SpecStreamProps {
  text: string;
  isStreaming: boolean;
}

/** Un token del JSON con su rol léxico, para colorearlo. */
type Token = { kind: "key" | "string" | "number" | "boolean" | "punct" | "plain"; value: string };

/**
 * Tokeniza JSON parcial. Tiene que tolerar texto cortado a media cadena, porque eso es
 * exactamente lo que llega mientras el modelo genera: `JSON.parse` aquí no sirve.
 */
export function tokenizeJson(text: string): Token[] {
  const tokens: Token[] = [];
  // Cadenas (incluidas las sin cerrar al final), números, booleanos/null y puntuación.
  const pattern = /("(?:[^"\\]|\\.)*"?)|(-?\d+(?:\.\d+)?)|\b(true|false|null)\b|([{}[\],:])/gu;

  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      tokens.push({ kind: "plain", value: text.slice(lastIndex, match.index) });
    }

    const [raw, str, num, bool, punct] = match;

    if (str !== undefined) {
      // Una cadena seguida de `:` es una clave. Se mira el siguiente carácter no blanco.
      const after = text.slice(match.index + raw.length);
      const isKey = /^\s*:/u.test(after);
      tokens.push({ kind: isKey ? "key" : "string", value: raw });
    } else if (num !== undefined) {
      tokens.push({ kind: "number", value: raw });
    } else if (bool !== undefined) {
      tokens.push({ kind: "boolean", value: raw });
    } else if (punct !== undefined) {
      tokens.push({ kind: "punct", value: raw });
    }

    lastIndex = match.index + raw.length;
  }

  if (lastIndex < text.length) {
    tokens.push({ kind: "plain", value: text.slice(lastIndex) });
  }

  return tokens;
}

const CLASS_BY_KIND: Record<Token["kind"], string | undefined> = {
  key: styles.key,
  string: styles.string,
  number: styles.number,
  boolean: styles.boolean,
  punct: styles.punct,
  plain: undefined,
};

export function SpecStream({ text, isStreaming }: SpecStreamProps) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Autoscroll mientras llega texto, pero sólo si el usuario no ha subido a leer.
  useEffect(() => {
    const wrapper = wrapperRef.current;
    if (wrapper === null || !isStreaming) return;

    const distanceFromBottom =
      wrapper.scrollHeight - wrapper.scrollTop - wrapper.clientHeight;
    if (distanceFromBottom < 120) {
      wrapper.scrollTop = wrapper.scrollHeight;
    }
  }, [text, isStreaming]);

  if (text === "") {
    return (
      <div className={styles.wrapper} ref={wrapperRef}>
        <p className={styles.empty}>
          La especificación aparecerá aquí según la genere el modelo.
        </p>
      </div>
    );
  }

  const tokens = tokenizeJson(text);

  return (
    <div className={styles.wrapper} ref={wrapperRef}>
      <pre className={styles.code}>
        <code>
          {tokens.map((token, index): ReactNode => {
            const className = CLASS_BY_KIND[token.kind];
            return (
              <Fragment key={index}>
                {className === undefined ? (
                  token.value
                ) : (
                  <span className={className}>{token.value}</span>
                )}
              </Fragment>
            );
          })}
          {isStreaming && <span className={styles.caret} aria-hidden="true" />}
        </code>
      </pre>
    </div>
  );
}
