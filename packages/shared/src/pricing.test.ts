import { describe, expect, it } from "vitest";
import { estimateCostUsd } from "./pricing.js";

describe("estimateCostUsd", () => {
  it("calcula el coste de input+output para claude-opus-5 sin caché", () => {
    const cost = estimateCostUsd({
      model: "claude-opus-5",
      inputTokens: 1_000_000,
      outputTokens: 500_000,
    });
    // 1M in * $5/MTok + 0.5M out * $25/MTok = 5 + 12.5
    expect(cost).toBeCloseTo(17.5, 10);
  });

  it("calcula el coste con cache read para claude-sonnet-5", () => {
    const cost = estimateCostUsd({
      model: "claude-sonnet-5",
      inputTokens: 100_000,
      outputTokens: 0,
      cacheReadTokens: 1_000_000,
    });
    // 0.1M in * $3/MTok + 1M cache-read * ($3 * 0.1)/MTok = 0.3 + 0.3
    expect(cost).toBeCloseTo(0.6, 10);
  });

  it("calcula el coste con cache creation para claude-opus-5", () => {
    const cost = estimateCostUsd({
      model: "claude-opus-5",
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationTokens: 1_000_000,
    });
    // 1M cache-write * ($5 * 1.25)/MTok = 6.25
    expect(cost).toBeCloseTo(6.25, 10);
  });

  it("da coste 0 para una petición completamente en caché sin tokens nuevos", () => {
    const cost = estimateCostUsd({
      model: "claude-sonnet-5",
      inputTokens: 0,
      outputTokens: 0,
    });
    expect(cost).toBe(0);
  });
});
