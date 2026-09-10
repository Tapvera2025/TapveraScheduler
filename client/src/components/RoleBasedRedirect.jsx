import { Navigate } from "react-router-dom";

/**
 * RoleBasedRedirect - sends an authenticated user to the home page for their role
 * Used for the root path and as the catch-all fallback
 */
export default function RoleBasedRedirect() {
  const isAuthenticated = localStorage.getItem("isAuthenticated");
  const token = localStorage.getItem("token");
  const userRole = localStorage.getItem("userRole");

  if (!isAuthenticated || !token) {
    return <Navigate to="/login" replace />;
  }

  if (userRole === "master") {
    return <Navigate to="/master" replace />;
  }

  if (userRole === "admin" || userRole === "manager") {
    return <Navigate to="/dashboard" replace />;
  }

  if (userRole === "user") {
    return <Navigate to="/user" replace />;
  }

  // Unknown or missing role — back to login
  return <Navigate to="/login" replace />;
}
