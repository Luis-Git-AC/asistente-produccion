import { describe, expect, it } from "vitest";
import type { SpriteTag } from "@asistente/shared";
import { frameSequence } from "./SpritePreview.js";

function tag(overrides: Partial<SpriteTag>): SpriteTag {
  return { name: "idle", from: 0, to: 3, direction: "forward", ...overrides };
}

describe("frameSequence", () => {
  it("forward recorre el rango en orden", () => {
    expect(frameSequence(tag({ from: 0, to: 3, direction: "forward" }))).toEqual([0, 1, 2, 3]);
  });

  it("reverse recorre el rango al revés", () => {
    expect(frameSequence(tag({ from: 0, to: 3, direction: "reverse" }))).toEqual([3, 2, 1, 0]);
  });

  it("pingpong rebota sin repetir los extremos", () => {
    // Repetir el primer y el último frame produce un tirón visible en el bucle.
    expect(frameSequence(tag({ from: 0, to: 3, direction: "pingpong" }))).toEqual([
      0, 1, 2, 3, 2, 1,
    ]);
  });

  it("respeta rangos que no empiezan en 0", () => {
    expect(frameSequence(tag({ from: 4, to: 6, direction: "forward" }))).toEqual([4, 5, 6]);
    expect(frameSequence(tag({ from: 4, to: 6, direction: "pingpong" }))).toEqual([4, 5, 6, 5]);
  });

  it("un tag de un solo frame no rebota", () => {
    expect(frameSequence(tag({ from: 2, to: 2, direction: "pingpong" }))).toEqual([2]);
    expect(frameSequence(tag({ from: 2, to: 2, direction: "forward" }))).toEqual([2]);
  });

  it("un tag de dos frames en pingpong no duplica", () => {
    expect(frameSequence(tag({ from: 0, to: 1, direction: "pingpong" }))).toEqual([0, 1]);
  });
});
