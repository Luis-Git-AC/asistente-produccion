import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Resuelve el workspace desde su código fuente: el dev server y el build no dependen de
      // un build previo de @asistente/shared.
      "@asistente/shared": fileURLToPath(new URL("../shared/src/index.ts", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxy hacia el backend: evita CORS en desarrollo y deja las rutas relativas (`/api/...`)
    // funcionando igual en dev que en producción.
    proxy: {
      "/api": {
        target: "http://127.0.0.1:3000",
        changeOrigin: true,
      },
    },
  },
});
