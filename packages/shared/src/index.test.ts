import { describe, expect, it } from "vitest";
import { SHARED_PACKAGE_NAME } from "./index.js";

describe("@asistente/shared bootstrap", () => {
  it("exports a package name", () => {
    expect(SHARED_PACKAGE_NAME).toBe("@asistente/shared");
  });
});
