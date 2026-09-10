import { Navigate } from "react-router-dom";

/**
 * MasterRoute - the platform master admin area
 *
 * The API enforces this too (requireMaster); this just keeps organisation users
 * out of screens that would only 403 at them.
 */
export default function MasterRoute({ children }) {
  const isAuthenticated = localStorage.getItem("isAuthenticated");
  const token = localStorage.getItem("token");
  const userRole = localStorage.getItem("userRole");

  if (!isAuthenticated || !token) {
    return <Navigate to="/login" replace />;
  }

  if (userRole !== "master") {
    return <Navigate to="/dashboard" replace />;
  }

  return children;
}
