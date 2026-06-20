import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { StoreProvider } from "./store/StoreContext.jsx";
import { ToastProvider } from "./components/Toast.jsx";
import App from "./App.jsx";
import { initCompactMode } from "./lib/compactMode.js";
import "./styles/theme.css";

initCompactMode();

const routerBase = import.meta.env.BASE_URL.replace(/\/$/, "") || undefined;

createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <BrowserRouter basename={routerBase}>
      <ToastProvider>
        <StoreProvider>
          <App />
        </StoreProvider>
      </ToastProvider>
    </BrowserRouter>
  </React.StrictMode>
);
