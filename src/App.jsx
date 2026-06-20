import React from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import AdminGuard from "./components/AdminGuard.jsx";
import ProjectsPage from "./pages/admin/ProjectsPage.jsx";
import NewProjectPage from "./pages/admin/NewProjectPage.jsx";
import SpecEditorPage from "./pages/admin/SpecEditorPage.jsx";
import MaterialsPage from "./pages/admin/MaterialsPage.jsx";
import ImportPage from "./pages/admin/ImportPage.jsx";
import ClientsPage from "./pages/admin/ClientsPage.jsx";
import ModulesPage from "./pages/admin/ModulesPage.jsx";
import SuppliersPage from "./pages/admin/SuppliersPage.jsx";
import ArchivePage from "./pages/admin/ArchivePage.jsx";
import SettingsPage from "./pages/admin/SettingsPage.jsx";
import PhotosPage from "./pages/admin/PhotosPage.jsx";
import ClientProjectPage from "./pages/client/ClientProjectPage.jsx";

function ClientLegacyRedirect() {
  const { token } = useParams();
  return <Navigate to={`/client/p/${token}`} replace />;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route path="/client/p/:token" element={<ClientProjectPage />} />
      <Route path="/client/:token" element={<ClientLegacyRedirect />} />

      <Route element={<AdminGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<ProjectsPage />} />
          <Route path="/clients" element={<ClientsPage />} />
          <Route path="/modules" element={<ModulesPage />} />
          <Route path="/materials" element={<MaterialsPage />} />
          <Route path="/photos" element={<PhotosPage />} />
          <Route path="/suppliers" element={<SuppliersPage />} />
          <Route path="/import" element={<ImportPage />} />
          <Route path="/archive" element={<ArchivePage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="/new" element={<NewProjectPage />} />
          <Route path="/project/:id" element={<SpecEditorPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
