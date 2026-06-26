import React, { Suspense, lazy } from "react";
import { Routes, Route, Navigate, useParams } from "react-router-dom";
import Layout from "./components/Layout.jsx";
import AdminGuard from "./components/AdminGuard.jsx";
import { ClientAccessDenied, ClientScope } from "./components/ClientGuard.jsx";
import PageSkeleton from "./components/PageSkeleton.jsx";
import LoginPage from "./pages/admin/LoginPage.jsx";

const ProjectsPage = lazy(() => import("./pages/admin/ProjectsPage.jsx"));
const ProjectBuilderPage = lazy(() => import("./pages/admin/ProjectBuilderPage.jsx"));
const SpecEditorPage = lazy(() => import("./pages/admin/SpecEditorPage.jsx"));
const MaterialsPage = lazy(() => import("./pages/admin/MaterialsPage.jsx"));
const MaterialsQualityPage = lazy(() => import("./pages/admin/MaterialsQualityPage.jsx"));
const ClientsPage = lazy(() => import("./pages/admin/ClientsPage.jsx"));
const ModulesPage = lazy(() => import("./pages/admin/ModulesPage.jsx"));
const SuppliersPage = lazy(() => import("./pages/admin/SuppliersPage.jsx"));
const ReportsPage = lazy(() => import("./pages/admin/ReportsPage.jsx"));
const ArchivePage = lazy(() => import("./pages/admin/ArchivePage.jsx"));
const SettingsPage = lazy(() => import("./pages/admin/SettingsPage.jsx"));
const PhotosPage = lazy(() => import("./pages/admin/PhotosPage.jsx"));
const ClientProjectPage = lazy(() => import("./pages/client/ClientProjectPage.jsx"));

function RouteFallback() {
  return (
    <div className="main-inner">
      <PageSkeleton lines={3} />
    </div>
  );
}

function Lazy({ children }) {
  return <Suspense fallback={<RouteFallback />}>{children}</Suspense>;
}

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
      <Route
        path="/client/p/:token"
        element={
          <ClientScope>
            <Lazy>
              <ClientProjectPage />
            </Lazy>
          </ClientScope>
        }
      />
      <Route path="/client/:token" element={<ClientLegacyRedirect />} />
      <Route path="/client/*" element={<ClientAccessDenied />} />

      <Route path="/login" element={<LoginPage />} />

      <Route element={<AdminGuard />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Lazy><ProjectsPage /></Lazy>} />
          <Route path="/clients" element={<Lazy><ClientsPage /></Lazy>} />
          <Route path="/modules" element={<Lazy><ModulesPage /></Lazy>} />
          <Route path="/materials" element={<Lazy><MaterialsPage /></Lazy>} />
          <Route path="/materials/photos" element={<Lazy><PhotosPage /></Lazy>} />
          <Route path="/materials/quality" element={<Lazy><MaterialsQualityPage /></Lazy>} />
          <Route path="/import" element={<Navigate to="/materials?tab=import" replace />} />
          <Route path="/suppliers" element={<Lazy><SuppliersPage /></Lazy>} />
          <Route path="/archive" element={<Lazy><ArchivePage /></Lazy>} />
          <Route path="/reports" element={<Lazy><ReportsPage /></Lazy>} />
          <Route path="/settings" element={<Lazy><SettingsPage /></Lazy>} />
          <Route path="/new" element={<Lazy><ProjectBuilderPage /></Lazy>} />
          <Route path="/new/template" element={<Navigate to="/new" replace />} />
          <Route path="/project/:id" element={<Lazy><SpecEditorPage /></Lazy>} />
        </Route>
      </Route>

      <Route path="*" element={<FallbackRoute />} />
    </Routes>
  );
}
