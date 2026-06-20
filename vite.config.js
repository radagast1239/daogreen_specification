import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const forPages = process.env.GITHUB_PAGES === "true";
  const basePath = env.VITE_BASE_PATH || (forPages ? "/daogreen_specification/" : "/");

  return {
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
  };
});
