import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import { ConfigError, hasAnyCredential, loadConfig, repoRoot } from "./config.js";

describe("hasAnyCredential", () => {
  it("acepta ANTHROPIC_API_KEY", () => {
    expect(hasAnyCredential({ ANTHROPIC_API_KEY: "sk-ant-x", ANTHROPIC_CONFIG_DIR: "/no/existe" })).toBe(
      true,
    );
  });

  it("acepta ANTHROPIC_AUTH_TOKEN aunque no haya API key", () => {
    // El SDK resuelve también este; exigir la key dejaba fuera un entorno válido.
    expect(hasAnyCredential({ ANTHROPIC_AUTH_TOKEN: "oat-x", ANTHROPIC_CONFIG_DIR: "/no/existe" })).toBe(
      true,
    );
  });

  it("no acepta una cadena vacía como credencial", () => {
    expect(
      hasAnyCredential({ ANTHROPIC_API_KEY: "   ", ANTHROPIC_CONFIG_DIR: "/no/existe" }),
    ).toBe(false);
  });

  it("sin nada, y sin perfil de ant en disco, no hay credencial", () => {
    expect(hasAnyCredential({ ANTHROPIC_CONFIG_DIR: "/ruta/que/no/existe" })).toBe(false);
  });
});

describe("loadConfig", () => {
  it("aplica valores por defecto sensatos con un entorno vacío", () => {
    const config = loadConfig({ env: {} });

    expect(config.port).toBe(3000);
    expect(config.asepriteWsPort).toBe(3001);
    expect(config.cacheTtlSeconds).toBe(86_400);
    expect(config.simulate5xx).toBe(false);
    expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
    // Absoluta y anclada a la raíz del repo: ver config.paths.test.ts.
    expect(config.asepriteOutputDir).toBe(resolve(repoRoot(), "output"));
  });

  it("no exige la API key salvo que se pida explícitamente", () => {
    expect(() => loadConfig({ env: {} })).not.toThrow();
  });

  it("falla rápido y con un mensaje accionable si falta ANTHROPIC_API_KEY", () => {
    const act = (): unknown =>
      loadConfig({ env: { ANTHROPIC_CONFIG_DIR: "/ruta/que/no/existe" }, requireApiKey: true });

    expect(act).toThrow(ConfigError);
    expect(act).toThrow(/ANTHROPIC_API_KEY/u);
    // El mensaje debe mencionar la distinción suscripción vs API: es la confusión más cara.
    expect(act).toThrow(/suscripción de Claude.ai NO es lo mismo/u);
    // El mensaje dice CÓMO arreglarlo, no sólo qué falta.

  });

  it("acepta la key cuando está presente", () => {
    const config = loadConfig({
      env: { ANTHROPIC_API_KEY: "sk-ant-test" },
      requireApiKey: true,
    });
    expect(config.anthropicApiKey).toBe("sk-ant-test");
  });

  it("interpreta SIMULATE_5XX", () => {
    expect(loadConfig({ env: { SIMULATE_5XX: "1" } }).simulate5xx).toBe(true);
    expect(loadConfig({ env: { SIMULATE_5XX: "true" } }).simulate5xx).toBe(true);
    expect(loadConfig({ env: { SIMULATE_5XX: "0" } }).simulate5xx).toBe(false);
    expect(loadConfig({ env: { SIMULATE_5XX: "no" } }).simulate5xx).toBe(false);
  });

  it("parsea CORS_ORIGINS separados por coma y descarta vacíos", () => {
    const config = loadConfig({
      env: { CORS_ORIGINS: "http://a.test, http://b.test ,," },
    });
    expect(config.corsOrigins).toEqual(["http://a.test", "http://b.test"]);
  });

  it("rechaza un PORT que no es un entero positivo", () => {
    expect(() => loadConfig({ env: { PORT: "no-soy-un-puerto" } })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { PORT: "-1" } })).toThrow(ConfigError);
    expect(() => loadConfig({ env: { PORT: "3.5" } })).toThrow(ConfigError);
  });

  it("el mensaje de configuración inválida señala la variable concreta", () => {
    expect(() => loadConfig({ env: { CACHE_TTL_SECONDS: "cero" } })).toThrow(
      /CACHE_TTL_SECONDS/u,
    );
  });

  it("respeta valores explícitos por encima de los defaults", () => {
    const config = loadConfig({
      env: { PORT: "8080", ASEPRITE_WS_PORT: "4444", DB_PATH: "/tmp/x.db", CACHE_TTL_SECONDS: "60" },
    });

    expect(config.port).toBe(8080);
    expect(config.asepriteWsPort).toBe(4444);
    // Ya es absoluta (tambien en Windows), asi que se respeta tal cual.
    expect(config.dbPath).toBe("/tmp/x.db");
    expect(config.cacheTtlSeconds).toBe(60);
  });
});
