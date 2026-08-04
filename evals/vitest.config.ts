import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    // Mismos alias que `tsconfig.json`: los tests no dependen de un build previo de los
    // workspaces. `@asistente/server` no se aliasa aquí porque sólo lo usa el camino `--record`,
    // que no se ejercita en tests (haría red).
    alias: {
      "@asistente/shared": fileURLToPath(
        new URL("../packages/shared/src/index.ts", import.meta.url),
      ),
      "@asistente/mcp-aseprite": fileURLToPath(
        new URL("../packages/mcp-aseprite/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    include: ["src/**/*.test.ts"],
  },
});
