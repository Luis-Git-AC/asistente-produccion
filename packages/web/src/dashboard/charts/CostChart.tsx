import type { CostBucket } from "@asistente/shared";
import { modelColor, sortModels } from "../seriesMapping.js";
import {
  CHART_WIDTH,
  ChartEmpty,
  ChartFrame,
  GridLines,
  chartStyles,
  formatUsd,
  niceMax,
  scale,
} from "./primitives.js";

const HEIGHT = 190;

/**
 * Coste acumulado en el tiempo, apilado por modelo.
 *
 * Forma: área apilada. El trabajo del dato es "parte del todo a lo largo del tiempo" — cuánto
 * llevamos gastado y qué modelo lo consumió. Un multi-línea respondería a "cuál gasta más" pero
 * no dejaría leer el total de un vistazo, que es la pregunta principal del panel.
 */
export function CostChart({
  series,
  models: rawModels,
}: {
  series: CostBucket[];
  models: string[];
}) {
  const hasData = series.some((bucket) => bucket.cumulativeUsd > 0);
  if (!hasData) {
    return <ChartEmpty label="Sin coste registrado en esta ventana." />;
  }

  // El payload los trae ordenados por volumen; aquí se reordena al orden canónico para que el
  // apilado y el color no dependan de qué modelo se usó más en esta ventana.
  const models = sortModels(rawModels);

  // Acumulado por modelo: cada capa es la suma de su modelo hasta ese punto.
  const running = new Map<string, number>(models.map((model) => [model, 0]));
  const stackedPoints = series.map((bucket) => {
    for (const model of models) {
      running.set(model, (running.get(model) ?? 0) + (bucket.costByModel[model] ?? 0));
    }
    return { startMs: bucket.startMs, byModel: new Map(running) };
  });

  const total = series.at(-1)?.cumulativeUsd ?? 0;
  const max = niceMax(total);
  const stepX = series.length > 1 ? CHART_WIDTH / (series.length - 1) : CHART_WIDTH;

  /** Construye el polígono de una capa apilada: borde superior + vuelta por el inferior. */
  const layerPath = (modelIndex: number): string => {
    const upper: string[] = [];
    const lower: string[] = [];

    stackedPoints.forEach((point, i) => {
      const x = i * stepX;
      let below = 0;
      for (let m = 0; m < modelIndex; m += 1) {
        below += point.byModel.get(models[m] ?? "") ?? 0;
      }
      const value = below + (point.byModel.get(models[modelIndex] ?? "") ?? 0);

      upper.push(`${String(x)},${String(HEIGHT - scale(value, max, HEIGHT))}`);
      lower.push(`${String(x)},${String(HEIGHT - scale(below, max, HEIGHT))}`);
    });

    return `M${upper.join(" L")} L${lower.reverse().join(" L")} Z`;
  };

  const totalsByModel = models.map(
    (model) => stackedPoints.at(-1)?.byModel.get(model) ?? 0,
  );

  return (
    <ChartFrame
      description={`Coste acumulado: ${formatUsd(total)} en la ventana`}
      height={HEIGHT}
      legend={models.map((model, index) => ({
        label: model.replace(/^claude-/u, ""),
        color: modelColor(model),
        value: formatUsd(totalsByModel[index] ?? 0),
      }))}
    >
      <GridLines ticks={[max / 2, max]} height={HEIGHT} format={formatUsd} />
      {/* Se pinta de la capa superior a la inferior para que el borde de cada una quede visible. */}
      {models.map((model, index) => (
        <path key={model} d={layerPath(index)} fill={modelColor(model)} fillOpacity={0.85} />
      ))}
      <line
        x1={0}
        x2={CHART_WIDTH}
        y1={HEIGHT}
        y2={HEIGHT}
        className={chartStyles.axis}
      />
    </ChartFrame>
  );
}
