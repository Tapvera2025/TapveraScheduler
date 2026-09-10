import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Toaster } from "react-hot-toast";
import { SocketProvider } from "./contexts/SocketContext";

import MainLayout from "./components/layout/MainLayout";
import UserLayout from "./components/layout/UserLayout";
import MasterLayout from "./components/layout/MasterLayout";
import AdminRoute from "./components/AdminRoute";
import EmployeeRoute from "./components/EmployeeRoute";
import MasterRoute from "./components/MasterRoute";
import ModuleRoute from "./components/ModuleRoute";
import RoleBasedRedirect from "./components/RoleBasedRedirect";
import PortalHome from "./components/PortalHome";
import { MODULES } from "./constants/modules";
import Dashboard from "./pages/Dashboard";
import Scheduler from "./pages/Scheduler";
import Employees from "./pages/Employees";
import Clients from "./pages/Clients";
import Sites from "./pages/Sites";
import LeaveManagement from "./pages/LeaveManagement";
import Login from "./pages/Login";
import Profile from "./pages/Profile";
import Settings from "./pages/Settings";
import MyRoster from "./pages/user/MyRoster";
import UserProfile from "./pages/user/Profile";
import ChangePassword from "./pages/user/ChangePassword";
import ClockInOut from "./components/attendance/ClockInOut";
import TimeRecordsHistory from "./components/attendance/TimeRecordsHistory";
import ManagerTimeRecords from "./components/attendance/ManagerTimeRecords";
import MyLeave from "./pages/user/MyLeave";
import MyAdhoc from "./pages/user/MyAdhoc";
import AdhocRequests from "./pages/AdhocRequests";
import MasterOverview from "./pages/master/Overview";
import Organisations from "./pages/master/Organisations";
import CreateOrganisation from "./pages/master/CreateOrganisation";
import OrganisationDetail from "./pages/master/OrganisationDetail";

function App() {
  return (
    <SocketProvider>
      <BrowserRouter>
        <Routes>
          {/* Public Routes */}
          <Route path="/login" element={<Login />} />

          {/* Master Admin (platform) Routes */}
          <Route
            path="/master"
            element={
              <MasterRoute>
                <MasterLayout />
              </MasterRoute>
            }
          >
            <Route index element={<MasterOverview />} />
            <Route path="organisations" element={<Organisations />} />
            <Route path="organisations/new" element={<CreateOrganisation />} />
            <Route path="organisations/:id" element={<OrganisationDetail />} />
          </Route>

          {/* Admin/Manager Protected Routes */}
          <Route
            path="/"
            element={
              <AdminRoute>
                <MainLayout />
              </AdminRoute>
            }
          >
            <Route index element={<RoleBasedRedirect />} />

            {/* Always available */}
            <Route path="dashboard" element={<Dashboard />} />
            <Route path="employees" element={<Employees />} />
            <Route path="profile" element={<Profile />} />
            <Route path="change-password" element={<ChangePassword />} />
            <Route path="settings" element={<Settings />} />

            {/* Scheduler module */}
            <Route
              path="scheduler"
              element={
                <ModuleRoute module={MODULES.SCHEDULER}>
                  <Scheduler />
                </ModuleRoute>
              }
            />

            {/* Adhoc shift requests */}
            <Route
              path="scheduler/adhoc"
              element={
                <ModuleRoute module={MODULES.ADHOC}>
                  <AdhocRequests />
                </ModuleRoute>
              }
            />

            {/* Attendance module */}
            <Route
              path="attendance/records"
              element={
                <ModuleRoute module={MODULES.ATTENDANCE}>
                  <ManagerTimeRecords />
                </ModuleRoute>
              }
            />

            {/* Leave module */}
            <Route
              path="employees/leave"
              element={
                <ModuleRoute module={MODULES.LEAVE}>
                  <LeaveManagement />
                </ModuleRoute>
              }
            />

            {/* Sites module */}
            <Route
              path="company/sites"
              element={
                <ModuleRoute module={MODULES.SITES}>
                  <Sites />
                </ModuleRoute>
              }
            />

            {/* Clients module */}
            <Route
              path="company/clients"
              element={
                <ModuleRoute module={MODULES.CLIENTS}>
                  <Clients />
                </ModuleRoute>
              }
            />
          </Route>

          {/* User/Employee Portal Routes */}
          <Route
            path="/user"
            element={
              <EmployeeRoute>
                <UserLayout />
              </EmployeeRoute>
            }
          >
            {/* Lands on the first screen this organisation actually has */}
            <Route index element={<PortalHome />} />

            {/* Always available */}
            <Route path="profile" element={<UserProfile />} />
            <Route path="change-password" element={<ChangePassword />} />

            <Route
              path="roster"
              element={
                <ModuleRoute module={MODULES.SCHEDULER} redirectTo="/user/profile">
                  <MyRoster />
                </ModuleRoute>
              }
            />
            <Route
              path="clock"
              element={
                <ModuleRoute module={MODULES.ATTENDANCE} redirectTo="/user/profile">
                  <ClockInOut />
                </ModuleRoute>
              }
            />
            <Route
              path="history"
              element={
                <ModuleRoute module={MODULES.ATTENDANCE} redirectTo="/user/profile">
                  <TimeRecordsHistory />
                </ModuleRoute>
              }
            />
            <Route
              path="leave"
              element={
                <ModuleRoute module={MODULES.LEAVE} redirectTo="/user/profile">
                  <MyLeave />
                </ModuleRoute>
              }
            />
            <Route
              path="adhoc"
              element={
                <ModuleRoute module={MODULES.ADHOC} redirectTo="/user/profile">
                  <MyAdhoc />
                </ModuleRoute>
              }
            />
          </Route>

          {/* Fallback - Redirect to appropriate home based on role */}
          <Route path="*" element={<RoleBasedRedirect />} />
        </Routes>

        <Toaster position="top-right" toastOptions={{ style: { background: "hsl(var(--color-popover))", color: "hsl(var(--color-foreground))", border: "1px solid hsl(var(--color-border))", borderRadius: "12px", fontSize: "13px", boxShadow: "var(--shadow-lg)", maxWidth: "calc(100vw - 32px)" }, success: { iconTheme: { primary: "hsl(var(--color-success))", secondary: "hsl(var(--color-card))" } }, error: { iconTheme: { primary: "hsl(var(--color-error))", secondary: "hsl(var(--color-card))" } } }} />
      </BrowserRouter>
    </SocketProvider>
  );
}

export default App;
