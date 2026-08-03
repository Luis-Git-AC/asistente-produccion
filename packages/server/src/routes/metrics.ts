import { Router, type Request, type Response } from "express";
import type { MetricsRepository } from "../telemetry/types.js";
import { parseWindowMs } from "./sse.js";

/**
 * `GET /api/metrics?window=24h`
 *
 * Los agregados se calculan en el servidor. El cliente pinta; no hace `reduce` sobre miles de
 * filas ni recalcula el coste por su cuenta.
 */

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_RECENT_LIMIT = 50;
const MAX_RECENT_LIMIT = 500;

export interface MetricsRouteDeps {
  metrics: MetricsRepository;
  now?: () => number;
}

export function createMetricsRouter(deps: MetricsRouteDeps): Router {
  const router = Router();

  router.get("/metrics", (req: Request, res: Response) => {
    const windowMs = parseWindowMs(
      typeof req.query["window"] === "string" ? req.query["window"] : undefined,
      DEFAULT_WINDOW_MS,
    );

    const rawLimit = Number(req.query["limit"] ?? DEFAULT_RECENT_LIMIT);
    const limit =
      Number.isInteger(rawLimit) && rawLimit > 0 ? Math.min(rawLimit, MAX_RECENT_LIMIT) : DEFAULT_RECENT_LIMIT;

    const aggregate = deps.metrics.aggregate({
      windowMs,
      ...(deps.now ? { now: deps.now() } : {}),
    });

    res.json({ ...aggregate, recent: deps.metrics.recent(limit) });
  });

  return router;
}
