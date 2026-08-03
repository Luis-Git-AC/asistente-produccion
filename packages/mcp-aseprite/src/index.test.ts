import { describe, expect, it } from "vitest";
import { MCP_ASEPRITE_PACKAGE_NAME } from "./index.js";

describe("@asistente/mcp-aseprite bootstrap", () => {
  it("exports a package name", () => {
    expect(MCP_ASEPRITE_PACKAGE_NAME).toBe("@asistente/mcp-aseprite");
  });
});
