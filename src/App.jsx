import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import AdminGuard from "./components/AdminGuard.jsx";
import { ClientAccessDenied, ClientScope } from "./components/ClientGuard.jsx";
import ProjectsPage from "./pages/admin/ProjectsPage.jsx";
import ProjectBuilderPage from "./pages/admin/ProjectBuilderPage.jsx";
import SpecEditorPage from "./pages/admin/SpecEditorPage.jsx";
import MaterialsPage from "./pages/admin/MaterialsPage.jsx";
import ClientsPage from "./pages/admin/ClientsPage.jsx";
import ModulesPage from "./pages/admin/ModulesPage.jsx";
import SuppliersPage from "./pages/admin/SuppliersPage.jsx";
import ReportsPage from "./pages/admin/ReportsPage.jsx";
import ArchivePage from "./pages/admin/ArchivePage.jsx";
import SettingsPage from "./pages/admin/SettingsPage.jsx";
import LoginPage from "./pages/admin/LoginPage.jsx";
import ClientProjectPage from "./pages/client/ClientProjectPage.jsx";

function ClientLegacyRedirect() {
  const { token } = useParams();
  return <Navigate to={`/client/p/${token}`} replace />;
}

function FallbackRoute() {
  return <ClientAccessDenied />;
}

export default function App() {
  return (
    <Routes>
      {/* Клиент — только своя страница, без админки */}
      <Route
        path="/client/p/:token"
        element={
          <ClientScope>
            <ClientProjectPage />
          </ClientScope>
        }
      />
      <Route path="/client/:token" element={<ClientLegacyRedirect />} />
      <Route path="/client/*" element={<ClientAccessDenied />} />

      <Route path="/login" element={<LoginPage />} />

      <Route element={<AdminGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/import" element={<Navigate to="/materials?tab=import" replace />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/new" element={<ProjectBuilderPage />} />
          <Route path="/new/template" element={<Navigate to="/new" replace />} />
          <Route path="/project/:id" element={<SpecEditorPage />} />
        </Route>
      </Route>

      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  );
}
