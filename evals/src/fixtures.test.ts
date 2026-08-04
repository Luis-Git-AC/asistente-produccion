import { MODEL_IDS } from "@asistente/shared";
import { describe, expect, it } from "vitest";
import { loadCases } from "./cases.js";
import { fixtureFileName, loadFixture, sha256 } from "./fixtures.js";
import { validateResponse } from "./run.js";

const cases = loadCases();
const MODEL = MODEL_IDS[0];

describe("fixtures", () => {
  it("la clave de un fixture no depende de la hora ni del contenido", () => {
    const first = fixtureFileName("mi-caso", MODEL);
    const second = fixtureFileName("mi-caso", MODEL);
    expect(first).toBe(second);
    expect(first).toBe(`mi-caso.${MODEL}.json`);
  });

  it("todos los casos tienen fixture para el modelo por defecto", () => {
    for (const evalCase of cases) {
      expect(() => loadFixture(evalCase, MODEL), evalCase.id).not.toThrow();
    }
  });

  it("el hash grabado corresponde al prompt actual del caso", () => {
    for (const evalCase of cases) {
      const fixture = loadFixture(evalCase, MODEL);
      expect(fixture.promptSha256, evalCase.id).toBe(sha256(evalCase.prompt));
    }
  });

  /**
   * Un fixture grabado con otra versión del prompt mide el sistema de ayer y lo presenta como
   * el de hoy. Tiene que romper, no avisar.
   */
  it("un prompt cambiado invalida el fixture", () => {
    const first = cases[0];
    expect(first).toBeDefined();
    if (first === undefined) return;
    expect(() =>
      loadFixture({ ...first, prompt: `${first.prompt} y además un pony` }, MODEL),
    ).toThrow(/obsoleto/u);
  });

  it("la respuesta grabada de cada fixture es un SpriteSpec válido", () => {
    for (const evalCase of cases) {
      const fixture = loadFixture(evalCase, MODEL);
      const { spec, issues } = validateResponse(fixture.responseText);
      expect(issues, `${evalCase.id}: ${issues.join("; ")}`).toHaveLength(0);
      expect(spec, evalCase.id).not.toBeNull();
    }
  });
});
