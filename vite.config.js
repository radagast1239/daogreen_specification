import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

const forPages = process.env.GITHUB_PAGES === "true";
const basePath = process.env.VITE_BASE_PATH || (forPages ? "/daogreen_specification/" : "/");

export default defineConfig({
  base: basePath,
  plugins: [react()],
  server: {
    port: 5173,
    open: true,
    proxy: {
      "/api": { target: "http://localhost:3001", changeOrigin: true },
      "/uploads": { target: "http://localhost:3001", changeOrigin: true },
    },
  },
});
