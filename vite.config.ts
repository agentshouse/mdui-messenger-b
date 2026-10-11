import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig({
  base: "./",
  plugins: [react(), tailwind()],
  resolve: {
    alias: {
      "@/registry": fileURLToPath(new URL("./registry", import.meta.url)),
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@agatx/serenada-core": fileURLToPath(
        new URL("./vendor/serenada-core/src/index.ts", import.meta.url),
      ),
    },
  },
  test: { environment: "jsdom", include: ["tests/**/*.test.{ts,tsx}"], exclude: ["tests/support/**"] },
  build: { sourcemap: false, modulePreload: { polyfill: false } },
});
