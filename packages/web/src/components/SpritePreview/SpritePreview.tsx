import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { SpriteSpec, SpriteTag } from "@asistente/shared";
import styles from "./SpritePreview.module.css";

/**
 * Preview del spritesheet con reproductor de animación por tag.
 *
 * El spritesheet se exporta con layout ROWS y grid uniforme (sin trim ni padding), así que la
 * posición de cada frame es puramente aritmética: no hace falta leer el JSON de metadatos.
 * El número de columnas se deduce del ancho real de la imagen cargada.
 */

interface SpritePreviewProps {
  spec: SpriteSpec;
  spritesheetUrl: string | null;
}

/** Secuencia de índices de frame que produce un tag según su dirección. */
export function frameSequence(tag: SpriteTag): number[] {
  const forward: number[] = [];
  for (let i = tag.from; i <= tag.to; i += 1) forward.push(i);

  if (tag.direction === "reverse") return [...forward].reverse();
  if (tag.direction === "pingpong") {
    // El primer y último frame no se repiten en el rebote: repetirlos produce un tirón visible.
    const back = [...forward].slice(1, -1).reverse();
    return [...forward, ...back];
  }
  return forward;
}

const ZOOM_MAX = 12;

export function SpritePreview({ spec, spritesheetUrl }: SpritePreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [isPlaying, setIsPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [tagIndex, setTagIndex] = useState(0);
  const [position, setPosition] = useState(0);

  const tagSelectId = useId();
  const speedId = useId();

  const tags = spec.tags;
  const activeTag = tags[tagIndex];
  const sequence = useMemo(
    () => (activeTag === undefined ? spec.frames.map((frame) => frame.index) : frameSequence(activeTag)),
    [activeTag, spec.frames],
  );

  const currentFrame = sequence[position % sequence.length] ?? 0;

  // Carga de la imagen. Se reinicia con la URL para no mostrar el sprite anterior.
  useEffect(() => {
    if (spritesheetUrl === null) {
      setImage(null);
      return;
    }
    setLoadFailed(false);
    setImage(null);

    const img = new Image();
    let cancelled = false;
    img.onload = () => {
      if (!cancelled) setImage(img);
    };
    img.onerror = () => {
      if (!cancelled) setLoadFailed(true);
    };
    img.src = spritesheetUrl;

    return () => {
      cancelled = true;
    };
  }, [spritesheetUrl]);

  // Al cambiar de tag se vuelve al principio de su secuencia.
  useEffect(() => {
    setPosition(0);
  }, [tagIndex]);

  // Avance de la animación, respetando la duración real de cada frame.
  useEffect(() => {
    if (!isPlaying || sequence.length <= 1) return;

    const frameIndex = sequence[position % sequence.length] ?? 0;
    const durationMs = spec.frames[frameIndex]?.durationMs ?? 100;
    const timer = setTimeout(
      () => {
        setPosition((value) => value + 1);
      },
      Math.max(16, durationMs / speed),
    );

    return () => {
      clearTimeout(timer);
    };
  }, [isPlaying, position, sequence, spec.frames, speed]);

  // Pintado del frame actual.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null || image === null) return;

    const context = canvas.getContext("2d");
    if (context === null) return;

    const { width, height } = spec.canvas;
    const columns = Math.max(1, Math.floor(image.width / width));
    const sourceX = (currentFrame % columns) * width;
    const sourceY = Math.floor(currentFrame / columns) * height;

    context.imageSmoothingEnabled = false;
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, sourceX, sourceY, width, height, 0, 0, canvas.width, canvas.height);
  }, [image, currentFrame, spec.canvas]);

  // Zoom entero: un factor fraccionario rompería la rejilla de píxeles.
  const zoom = Math.max(1, Math.min(ZOOM_MAX, Math.floor(256 / Math.max(spec.canvas.width, spec.canvas.height))));
  const displayWidth = spec.canvas.width * zoom;
  const displayHeight = spec.canvas.height * zoom;

  if (spritesheetUrl === null) {
    return <p className={styles.empty}>El sprite aparecerá aquí cuando termine el render.</p>;
  }

  if (loadFailed) {
    return (
      <p className={`${styles.empty} ${styles.failed}`}>
        No se pudo cargar el spritesheet. Comprueba que el servidor sigue en marcha.
      </p>
    );
  }

  return (
    <div className={styles.container}>
      <div className={styles.stage}>
        <canvas
          ref={canvasRef}
          className={styles.canvas}
          width={displayWidth}
          height={displayHeight}
          role="img"
          aria-label={`Vista previa de ${spec.name}, frame ${String(currentFrame + 1)} de ${String(spec.frames.length)}`}
        />
      </div>

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.playButton}
          onClick={() => {
            setIsPlaying((value) => !value);
          }}
          disabled={sequence.length <= 1}
          aria-label={isPlaying ? "Pausar animación" : "Reproducir animación"}
        >
          {isPlaying ? "❚❚" : "▶"}
        </button>

        {tags.length > 0 && (
          <div className={styles.field}>
            <label className={styles.fieldLabel} htmlFor={tagSelectId}>
              Tag
            </label>
            <select
              id={tagSelectId}
              className={styles.select}
              value={tagIndex}
              onChange={(event) => {
                setTagIndex(Number(event.target.value));
              }}
              disabled={tags.length <= 1}
            >
              {tags.map((tag, index) => (
                <option key={tag.name} value={index}>
                  {tag.name} ({tag.direction})
                </option>
              ))}
            </select>
          </div>
        )}

        <div className={styles.field}>
          <label className={styles.fieldLabel} htmlFor={speedId}>
            Velocidad
          </label>
          <input
            id={speedId}
            className={styles.range}
            type="range"
            min={0.25}
            max={3}
            step={0.25}
            value={speed}
            onChange={(event) => {
              setSpeed(Number(event.target.value));
            }}
          />
          <span className={styles.speedValue}>{speed.toFixed(2)}×</span>
        </div>

        <span className={styles.frameCounter}>
          frame {String(currentFrame + 1)}/{String(spec.frames.length)} · {String(spec.canvas.width)}×
          {String(spec.canvas.height)}
        </span>
      </div>
    </div>
  );
}
