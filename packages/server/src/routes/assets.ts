import { createReadStream, existsSync, statSync } from "node:fs";
import { basename, extname, resolve, sep } from "node:path";
import { Router, type Request, type Response } from "express";

/**
 * `GET /api/assets/:file`
 *
 * Sirve por HTTP los assets que el MCP escribió en el directorio de salida, para que la web
 * pueda mostrar el spritesheet. Sin esto el preview no tiene nada que cargar: el evento `done`
 * devuelve rutas de disco, que un navegador no puede leer.
 *
 * El nombre viene de la URL, así que se trata como entrada hostil: `path.basename` + resolución
 * confinada al directorio permitido, igual que en el MCP.
 */

/** Sólo se sirven los formatos que produce el pipeline. Nada de servir el directorio entero. */
const ALLOWED_EXTENSIONS = new Map<string, string>([
  [".png", "image/png"],
  [".json", "application/json; charset=utf-8"],
]);

export interface AssetsRouteDeps {
  outputDir: string;
}

export function createAssetsRouter(deps: AssetsRouteDeps): Router {
  const router = Router();
  const outputDir = resolve(deps.outputDir);

  router.get("/assets/:file", (req: Request, res: Response) => {
    // basename() se lleva por delante cualquier intento de traversal en el parámetro.
    const requested = basename(String(req.params["file"] ?? ""));
    const extension = extname(requested).toLowerCase();
    const contentType = ALLOWED_EXTENSIONS.get(extension);

    if (contentType === undefined) {
      res.status(400).json({
        code: "unsupported_asset",
        message: `Sólo se sirven ${[...ALLOWED_EXTENSIONS.keys()].join(", ")}.`,
      });
      return;
    }

    const candidate = resolve(outputDir, requested);
    // Red de seguridad: aunque basename ya lo impide, se verifica el confinamiento.
    if (candidate !== outputDir && !candidate.startsWith(outputDir + sep)) {
      res.status(403).json({ code: "forbidden_path", message: "Ruta fuera del directorio." });
      return;
    }

    if (!existsSync(candidate) || !statSync(candidate).isFile()) {
      res.status(404).json({ code: "asset_not_found", message: `No existe ${requested}.` });
      return;
    }

    res.setHeader("Content-Type", contentType);
    // Los assets se regeneran con el mismo nombre: cachearlos mostraría el sprite anterior.
    res.setHeader("Cache-Control", "no-store");
    createReadStream(candidate).pipe(res);
  });

  return router;
}

/** Construye la URL pública de un asset a partir de su ruta en disco. */
export function toAssetUrl(filePath: string | null): string | null {
  if (filePath === null || filePath.trim() === "") return null;
  return `/api/assets/${encodeURIComponent(basename(filePath))}`;
}
