import { BrowserRouter as Router, Routes, Route, Navigate } from "react-router-dom";
import MainLayout from "./layouts/MainLayout";
import LoginPage from "./pages/LoginPage";
import Dashboard from "./pages/Dashboard";
import ProductionCharts from "./pages/ProductionCharts";
import Traceability from "./pages/Traceability";
import Machine from "./pages/Machine";
import UsersPage from "./pages/Users";
import ComponentJourney from "./pages/ComponentJourney";
import OperatorView from "./pages/OperatorView";
import QrFormatRules from "./pages/QrFormatRules";
import Scanners from "./pages/Scanners";
import Packing from "./pages/Packing";
import Shifts from "./pages/Shifts";
import MasterSettingsDashboard from "./pages/MasterSettingsDashboard";
import PlcConfiguration from "./pages/PlcConfiguration";
import IoMonitor from "./pages/IoMonitor";
import { isAuthenticated } from "./utils/authStorage";
import { APP_ROUTES } from "./constants/routes";

const ProtectedRoute = ({ children }) => {
  return isAuthenticated() ? children : <Navigate to={APP_ROUTES.login} replace />;
};

const PublicOnlyRoute = ({ children }) => {
  return isAuthenticated() ? <Navigate to={APP_ROUTES.dashboard} replace /> : children;
};

function App() {
  return (
    <Router>
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
          path={APP_ROUTES.root}
          element={
            <ProtectedRoute>
              <MainLayout />
            </ProtectedRoute>
          }
        >
          <Route index element={<Navigate to={APP_ROUTES.dashboard} replace />} />
          <Route path={APP_ROUTES.dashboard.slice(1)} element={<Dashboard />} />
          <Route path={APP_ROUTES.masterSettings.slice(1)} element={<MasterSettingsDashboard />} />
          <Route path={APP_ROUTES.production.slice(1)} element={<ProductionCharts />} />
          <Route path={APP_ROUTES.traceability.slice(1)} element={<Traceability />} />
          <Route path={APP_ROUTES.machines.slice(1)} element={<Machine />} />
          <Route path={APP_ROUTES.plcConfig.slice(1)} element={<PlcConfiguration />} />
          <Route path={APP_ROUTES.ioMonitor.slice(1)} element={<IoMonitor />} />
          <Route path={APP_ROUTES.users.slice(1)} element={<UsersPage />} />
          <Route path={APP_ROUTES.scanners.slice(1)} element={<Scanners />} />
          <Route path={APP_ROUTES.shifts.slice(1)} element={<Shifts />} />
          <Route path={APP_ROUTES.qrRules.slice(1)} element={<QrFormatRules />} />
          <Route path="admin" element={<Dashboard />} />
          <Route path={APP_ROUTES.partJourney.slice(1)} element={<ComponentJourney />} />
          <Route path={APP_ROUTES.operatorView.slice(1)} element={<OperatorView />} />
          <Route path={APP_ROUTES.packing.slice(1)} element={<Packing />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
