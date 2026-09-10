import { Navigate } from "react-router-dom";

/**
 * AdminRoute - Protects routes that should only be accessible by ADMIN or MANAGER roles
 * Redirects employees (USER role) to their portal
 * Redirects unauthenticated users to login
 */
export default function AdminRoute({ children }) {
  const isAuthenticated = localStorage.getItem("isAuthenticated");
  const token = localStorage.getItem("token");
  const userRole = localStorage.getItem("userRole");

  // If not authenticated, redirect to login
  if (!isAuthenticated || !token) {
    return <Navigate to="/login" replace />;
  }

  // Master admins belong in the platform panel, not an organisation's app
  if (userRole === "master") {
    return <Navigate to="/master" replace />;
  }

  // If authenticated but not admin/manager, redirect to employee portal
  if (userRole === "user") {
    return <Navigate to="/user" replace />;
  }

  // User is authenticated and has admin/manager role
  return children;
}
