import React from "react";
import { Outlet, useLocation } from "react-router-dom";
import AppModeNav from "./AppModeNav.jsx";

export default function ToolsShell() {
  const loc = useLocation();
  const mode = loc.pathname.includes("berry") ? "berry" : "economic";

  return (
    <div className="app-frame app-frame--tools">
      <AppModeNav active={mode} />
      <main className="tools-main">
        <Outlet />
      </main>
    </div>
  );
}
