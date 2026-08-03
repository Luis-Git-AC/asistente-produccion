import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("aplica valores por defecto sensatos con un entorno vacío", () => {
    const config = loadConfig({ env: {} });

    expect(config.port).toBe(3000);
    expect(config.asepriteWsPort).toBe(3001);
    expect(config.cacheTtlSeconds).toBe(86_400);
    expect(config.simulate5xx).toBe(false);
    expect(config.corsOrigins).toEqual(["http://localhost:5173"]);
    expect(config.asepriteOutputDir).toBe("output");
  });

  it("no exige la API key salvo que se pida explícitamente", () => {
    expect(() => loadConfig({ env: {} })).not.toThrow();
  });

  it("falla rápido y con un mensaje accionable si falta ANTHROPIC_API_KEY", () => {
    const act = (): unknown => loadConfig({ env: {}, requireApiKey: true });

    expect(act).toThrow(ConfigError);
    expect(act).toThrow(/ANTHROPIC_API_KEY/u);
    // El mensaje dice CÓMO arreglarlo, no sólo qué falta.
    expect(act).toThrow(/ant auth login/u);
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
    expect(config.dbPath).toBe("/tmp/x.db");
    expect(config.cacheTtlSeconds).toBe(60);
  });
});
