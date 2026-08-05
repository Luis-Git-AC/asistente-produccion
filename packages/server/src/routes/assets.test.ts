import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import express from "express";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAssetsRouter, toAssetUrl } from "./assets.js";

const OUT = resolve(process.cwd(), "output", "assets-test");
const OUTSIDE = resolve(process.cwd(), "output", "secreto.png");

function makeApp(): express.Express {
  const app = express();
  app.use("/api", createAssetsRouter({ outputDir: OUT }));
  return app;
}

beforeAll(() => {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(resolve(OUT, "gem-icon.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  writeFileSync(resolve(OUT, "gem-icon.json"), JSON.stringify({ frames: [] }));
  writeFileSync(resolve(OUT, "gem-icon.aseprite"), "binario");
  // Fichero hermano FUERA del directorio servido, para el test de traversal.
  writeFileSync(OUTSIDE, "no deberia servirse");
});

afterAll(() => {
  rmSync(resolve(process.cwd(), "output"), { recursive: true, force: true });
});

describe("toAssetUrl", () => {
  it("convierte una ruta de disco en URL servible", () => {
    expect(toAssetUrl("C:\\repo\\output\\gem-icon.png")).toBe("/api/assets/gem-icon.png");
    expect(toAssetUrl("/repo/output/gem-icon.png")).toBe("/api/assets/gem-icon.png");
  });

  it("recorta la ruta igual corra en Windows o en POSIX", () => {
    // path.basename() sólo parte por '\' cuando el proceso corre en Windows. Sin normalizar el
    // separador, esta misma llamada devuelve la ruta ENTERA percent-encoded en Linux — el test
    // de arriba pasaría en la máquina de desarrollo y fallaría en CI, que es el peor sitio para
    // enterarse. Aquí se comprueba la propiedad, no el comportamiento del sistema anfitrión.
    const url = toAssetUrl("C:\\repo\\output\\gem-icon.png") ?? "";

    expect(url).not.toContain("%5C");
    expect(url).not.toContain("repo");
  });

  it("devuelve null si no hay ruta", () => {
    expect(toAssetUrl(null)).toBeNull();
    expect(toAssetUrl("")).toBeNull();
  });

  it("escapa caracteres especiales del nombre", () => {
    expect(toAssetUrl("/out/gem icon.png")).toBe("/api/assets/gem%20icon.png");
  });
});

describe("GET /api/assets/:file", () => {
  it("sirve un PNG con su content-type", async () => {
    const response = await request(makeApp()).get("/api/assets/gem-icon.png");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toBe("image/png");
  });

  it("no cachea: el asset se regenera con el mismo nombre", async () => {
    const response = await request(makeApp()).get("/api/assets/gem-icon.png");

    // Con caché, tras regenerar verías el sprite anterior y creerías que no se actualizó.
    expect(response.headers["cache-control"]).toBe("no-store");
  });

  it("sirve el JSON de metadatos", async () => {
    const response = await request(makeApp()).get("/api/assets/gem-icon.json");

    expect(response.status).toBe(200);
    expect(response.headers["content-type"]).toContain("application/json");
  });

  it("404 si el fichero no existe", async () => {
    const response = await request(makeApp()).get("/api/assets/no-existe.png");

    expect(response.status).toBe(404);
    expect(response.body.code).toBe("asset_not_found");
  });

  it("rechaza extensiones que el pipeline no produce", async () => {
    const response = await request(makeApp()).get("/api/assets/gem-icon.aseprite");

    expect(response.status).toBe(400);
    expect(response.body.code).toBe("unsupported_asset");
  });

  it("un traversal no escapa del directorio servido", async () => {
    // El nombre pasa por basename, así que '../secreto.png' se reduce a 'secreto.png',
    // que no existe DENTRO del directorio servido.
    const response = await request(makeApp()).get("/api/assets/..%2Fsecreto.png");

    expect(response.status).not.toBe(200);
    expect(response.text).not.toContain("no deberia servirse");
  });

  it("un traversal profundo tampoco llega a nada", async () => {
    const response = await request(makeApp()).get(
      "/api/assets/..%2F..%2F..%2Fpackage.json",
    );

    expect(response.status).not.toBe(200);
  });
});
