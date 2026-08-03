import { describe, expect, it } from "vitest";
import { assertStructuredOutputCompatible, spriteSpecJsonSchema } from "./json-schema.js";

describe("spriteSpecJsonSchema", () => {
  it("compila a un objeto JSON Schema con properties de nivel superior", () => {
    const schema = spriteSpecJsonSchema();
    expect(schema["type"]).toBe("object");
    expect(schema["properties"]).toBeDefined();
  });
});

describe("assertStructuredOutputCompatible", () => {
  it("no lanza sobre el JSON Schema real de SpriteSpec (evita el 400 en producción)", () => {
    expect(() => assertStructuredOutputCompatible(spriteSpecJsonSchema())).not.toThrow();
  });

  it("no lanza sobre un schema trivial y compatible", () => {
    expect(() =>
      assertStructuredOutputCompatible({
        type: "object",
        properties: { a: { type: "string" } },
        required: ["a"],
        additionalProperties: false,
      }),
    ).not.toThrow();
  });

  it("lanza si encuentra minimum", () => {
    expect(() => assertStructuredOutputCompatible({ type: "number", minimum: 0 })).toThrow();
  });

  it("lanza si encuentra maximum", () => {
    expect(() => assertStructuredOutputCompatible({ type: "number", maximum: 10 })).toThrow();
  });

  it("lanza si encuentra minLength", () => {
    expect(() =>
      assertStructuredOutputCompatible({ type: "string", minLength: 1 }),
    ).toThrow();
  });

  it("lanza si encuentra maxLength", () => {
    expect(() =>
      assertStructuredOutputCompatible({ type: "string", maxLength: 10 }),
    ).toThrow();
  });

  it("lanza si encuentra minItems", () => {
    expect(() =>
      assertStructuredOutputCompatible({ type: "array", items: { type: "string" }, minItems: 1 }),
    ).toThrow();
  });

  it("lanza si encuentra pattern", () => {
    expect(() =>
      assertStructuredOutputCompatible({ type: "string", pattern: "^[a-z]+$" }),
    ).toThrow();
  });

  it("lanza si un objeto no tiene additionalProperties: false", () => {
    expect(() =>
      assertStructuredOutputCompatible({
        type: "object",
        properties: { a: { type: "string" } },
      }),
    ).toThrow();
  });

  it("lanza si additionalProperties es true", () => {
    expect(() =>
      assertStructuredOutputCompatible({
        type: "object",
        properties: { a: { type: "string" } },
        additionalProperties: true,
      }),
    ).toThrow();
  });

  it("recorre schemas anidados dentro de arrays e items", () => {
    expect(() =>
      assertStructuredOutputCompatible({
        type: "object",
        properties: {
          list: {
            type: "array",
            items: {
              type: "object",
              properties: { n: { type: "number", minimum: 0 } },
              additionalProperties: false,
            },
          },
        },
        additionalProperties: false,
      }),
    ).toThrow();
  });
});
