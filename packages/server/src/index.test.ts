import { describe, expect, it } from "vitest";
import { SERVER_PACKAGE_NAME } from "./index.js";

describe("@asistente/server bootstrap", () => {
  it("exports a package name", () => {
    expect(SERVER_PACKAGE_NAME).toBe("@asistente/server");
  });
});
