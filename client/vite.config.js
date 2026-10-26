import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: {
    port: 5180,
    // calls to /api go to the Express server, so the browser only ever talks to one origin (cookies just work)
    proxy: { "/api": "http://localhost:8100" },
  },
});
