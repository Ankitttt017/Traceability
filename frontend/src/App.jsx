import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { NotificationProvider } from "./context/NotificationContext";
import { LanguageProvider } from "./context/LanguageContext";
import MainLayout from "./layouts/MainLayout";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import ProductionCharts from "./pages/ProductionCharts";
import Traceability from "./pages/Traceability";
import Machine from "./pages/Machine";
import UsersPage from "./pages/Users";
import ComponentJourney from "./pages/ComponentJourney";
import ProcessFlow from "./pages/ProcessFlow";
import OperatorView from "./pages/OperatorView";
import QrFormatRules from "./pages/QrFormatRules";
import Scanners from "./pages/Scanners";
import ScannerMonitor from "./pages/ScannerMonitor";
import ControlPlan from "./pages/ControlPlan";
import Packing from "./pages/Packing";
import PackingManagement from "./pages/PackingManagement";
import FaqPage from "./pages/FaqPage";
import Shifts from "./pages/Shifts";
import MasterSettingsDashboard from "./pages/MasterSettingsDashboard";
import StationControls from "./pages/StationControls";
import PlcConfiguration from "./pages/PlcConfiguration";
import IoMonitor from "./pages/IoMonitor";
import ReportConfiguration from "./pages/ReportConfiguration";
import ReportsPage from "./pages/Reports/ReportsPage";
import { getUserRole, isAuthenticated } from "./utils/authStorage";
import { APP_ROUTES } from "./constants/routes";
import { canAccessModule, getRoleAccessSettings } from "./utils/roleAccess";
import PartProcessflow from "./pages/PartProcessflow.jsx";
const ProtectedRoute = ({ children }) => {
  return isAuthenticated() ? children : <Navigate to={APP_ROUTES.login} replace />;
};

const NoAccessScreen = () => (
  <div className="min-h-screen flex items-center justify-center bg-bg-base px-6">
    <div className="max-w-md w-full rounded-2xl border border-border bg-bg-card p-8 text-center shadow-xl">
      <h1 className="text-2xl font-black text-text-main mb-3">No Page Access</h1>
      <p className="text-sm text-text-muted">
        Your role does not currently have access to any page. Please ask an administrator to enable at least one module.
      </p>
    </div>
  </div>
);

function getFirstAccessibleRoute() {
  const role = getUserRole();
  const settings = getRoleAccessSettings();
  for (const entry of MODULE_REDIRECT_ORDER) {
    if (canAccessModule(role, entry.moduleKey, settings)) {
      return entry.path;
    }
  }
  return null;
}

const PublicOnlyRoute = ({ children }) => {
  if (!isAuthenticated()) {
    return children;
  }
  const fallback = getFirstAccessibleRoute();
  return fallback ? <Navigate to={fallback} replace /> : <NoAccessScreen />;
};

const MODULE_REDIRECT_ORDER = [
  { moduleKey: "dashboard", path: APP_ROUTES.dashboard },
  { moduleKey: "operator_view", path: APP_ROUTES.operatorView },
  { moduleKey: "packing", path: APP_ROUTES.packing },
  { moduleKey: "packing_management", path: APP_ROUTES.packingManagement },
  { moduleKey: "production", path: APP_ROUTES.production },
  { moduleKey: "reports", path: APP_ROUTES.reports },
  { moduleKey: "traceability", path: APP_ROUTES.traceability },
  { moduleKey: "io_monitor", path: APP_ROUTES.ioMonitor },
  { moduleKey: "part_journey", path: APP_ROUTES.partJourney },
  { moduleKey: "part_process_flow", path: APP_ROUTES.partProcessFlow },
  { moduleKey: "process_flow", path: APP_ROUTES.processFlow },
  { moduleKey: "master_settings", path: APP_ROUTES.masterSettings },
  { moduleKey: "station_control", path: APP_ROUTES.stationControls },
  { moduleKey: "report_config", path: APP_ROUTES.masterReports },
  { moduleKey: "machines", path: APP_ROUTES.machines },
  { moduleKey: "plc_config", path: APP_ROUTES.plcConfig },
  { moduleKey: "scanners", path: APP_ROUTES.scanners },
  { moduleKey: "scanner_monitor", path: APP_ROUTES.scannerMonitor },
  { moduleKey: "shifts", path: APP_ROUTES.shifts },
  { moduleKey: "qr_rules", path: APP_ROUTES.qrRules },
  { moduleKey: "users", path: APP_ROUTES.users },
  { moduleKey: "faq", path: APP_ROUTES.faq },
];

const ModuleRoute = ({ moduleKey, children }) => {
  const role = getUserRole();
  const settings = getRoleAccessSettings();
  const location = useLocation();
  if (canAccessModule(role, moduleKey, settings)) {
    return children;
  }
  const fallback = getFirstAccessibleRoute();
  if (!fallback || fallback === location.pathname) {
    return <NoAccessScreen />;
  }
  return <Navigate to={fallback} replace />;
};

function App() {
  return (
    <LanguageProvider>
    <NotificationProvider>
      <Router>
        <Toaster
          position="top-right"
          gutter={10}
          containerStyle={{ top: 16, right: 16 }}
          toastOptions={{
            duration: 3500,
            style: {
              background: "var(--app-bg-card)",
              color: "var(--app-text-main)",
              border: "1px solid var(--app-border)",
              borderRadius: "12px",
              padding: "12px 16px",
              fontSize: "13px",
              fontFamily: "inherit",
              boxShadow: "0 10px 26px rgba(0,0,0,0.35)",
              maxWidth: "380px",
            },
            success: {
              duration: 2800,
              iconTheme: { primary: "var(--app-success)", secondary: "var(--app-bg-card)" },
              style: {
                background:
                  "color-mix(in srgb, var(--app-success) 14%, var(--app-bg-card))",
                border: "1px solid color-mix(in srgb, var(--app-success) 50%, transparent)",
                color: "var(--app-text-main)",
                borderRadius: "12px",
                padding: "12px 16px",
                boxShadow: "0 0 18px color-mix(in srgb, var(--app-success) 45%, transparent)",
              },
            },
            error: {
              duration: 3500,
              iconTheme: { primary: "var(--app-danger)", secondary: "var(--app-bg-card)" },
              style: {
                background:
                  "color-mix(in srgb, var(--app-danger) 12%, var(--app-bg-card))",
                border: "1px solid color-mix(in srgb, var(--app-danger) 50%, transparent)",
                color: "var(--app-text-main)",
                borderRadius: "12px",
                padding: "12px 16px",
                boxShadow: "0 0 18px color-mix(in srgb, var(--app-danger) 45%, transparent)",
              },
            },
          }}
        />
        <Routes>
          <Route
            path={APP_ROUTES.login}
            element={
              <PublicOnlyRoute>
                <LoginPage />
              </PublicOnlyRoute>
            }
          />
          <Route
            path={APP_ROUTES.controlPlan}
            element={
              <ProtectedRoute>
                <ModuleRoute moduleKey="control_plan">
                  <ControlPlan />
                </ModuleRoute>
              </ProtectedRoute>
            }
          />

          <Route
            path={APP_ROUTES.root}
            element={
              <ProtectedRoute>
                <MainLayout />
              </ProtectedRoute>
            }
          >
            <Route
              index
              element={
                getFirstAccessibleRoute()
                  ? <Navigate to={getFirstAccessibleRoute()} replace />
                  : <NoAccessScreen />
              }
            />
            <Route
              path={APP_ROUTES.dashboard.slice(1)}
              element={
                <ModuleRoute moduleKey="dashboard">
                  <Dashboard />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.masterSettings.slice(1)}
              element={
                <ModuleRoute moduleKey="master_settings">
                  <MasterSettingsDashboard />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.stationControls.slice(1)}
              element={
                <ModuleRoute moduleKey="station_control">
                  <StationControls />
                </ModuleRoute>
              }
            />

            <Route
              path={APP_ROUTES.masterReports.slice(1)}
              element={
                <ModuleRoute moduleKey="report_config">
                  <ReportConfiguration />
                </ModuleRoute>
              }
            />

            
            <Route
              path={APP_ROUTES.production.slice(1)}
              element={
                <ModuleRoute moduleKey="production">
                  <ProductionCharts />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.reports.slice(1)}
              element={
                <ModuleRoute moduleKey="reports">
                  <ReportsPage />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.traceability.slice(1)}
              element={
                <ModuleRoute moduleKey="traceability">
                  <Traceability />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.machines.slice(1)}
              element={
                <ModuleRoute moduleKey="machines">
                  <Machine />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.plcConfig.slice(1)}
              element={
                <ModuleRoute moduleKey="plc_config">
                  <PlcConfiguration />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.ioMonitor.slice(1)}
              element={
                <ModuleRoute moduleKey="io_monitor">
                  <IoMonitor />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.users.slice(1)}
              element={
                <ModuleRoute moduleKey="users">
                  <UsersPage />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.scanners.slice(1)}
              element={
                <ModuleRoute moduleKey="scanners">
                  <Scanners />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.scannerMonitor.slice(1)}
              element={
                <ModuleRoute moduleKey="scanner_monitor">
                  <ScannerMonitor />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.shifts.slice(1)}
              element={
                <ModuleRoute moduleKey="shifts">
                  <Shifts />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.qrRules.slice(1)}
              element={
                <ModuleRoute moduleKey="qr_rules">
                  <QrFormatRules />
                </ModuleRoute>
              }
            />
            <Route
              path="admin"
              element={
                <ModuleRoute moduleKey="dashboard">
                  <Dashboard />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.partJourney.slice(1)}
              element={
                <ModuleRoute moduleKey="part_journey">
                  <ComponentJourney />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.processFlow.slice(1)}
              element={
                <ModuleRoute moduleKey="process_flow">
                  <ProcessFlow />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.operatorView.slice(1)}
              element={
                <ModuleRoute moduleKey="operator_view">
                  <OperatorView />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.packing.slice(1)}
              element={
                <ModuleRoute moduleKey="packing">
                  <Packing />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.faq.slice(1)}
              element={
                <ModuleRoute moduleKey="faq">
                  <FaqPage />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.partProcessFlow.slice(1)}
              element={
                <ModuleRoute moduleKey="part_process_flow">
                  <PartProcessflow />
                </ModuleRoute>
              }
            />
            <Route
              path={APP_ROUTES.packingManagement.slice(1)}
              element={
                <ModuleRoute moduleKey="packing_management">
                  <PackingManagement />
                </ModuleRoute>
              }
            />

          </Route>
        </Routes>
      </Router>
    </NotificationProvider>
    </LanguageProvider>

  );
}

export default App;
