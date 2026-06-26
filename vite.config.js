import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const forPages = process.env.GITHUB_PAGES === "true";
  const basePath = env.VITE_BASE_PATH || (forPages ? "/daogreen_specification/" : "/");

  return {
    base: basePath,
    plugins: [react()],
    build: {
      modulePreload: {
        resolveDependencies(_filename, deps) {
          return deps.filter((d) => !/(?:pdf-|xlsx-|html2canvas-|qr-)/.test(d));
        },
      },
      rollupOptions: {
        output: {
          manualChunks(id) {
            if (id.includes("vite/preload-helper")) return "vendor";
            if (!id.includes("node_modules")) return;
            if (id.includes("jspdf")) return "pdf";
            if (id.includes("xlsx")) return "xlsx";
            if (id.includes("qrcode")) return "qr";
            if (id.includes("html2canvas")) return "html2canvas";
            if (id.includes("react-router") || id.includes("react-dom") || id.includes("/react/")) return "vendor";
          },
        },
      },
    },
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
