import { Navigate } from "react-router-dom";
import { useModuleStore } from "../store/moduleStore";

/**
 * ModuleRoute - hides a screen whose module is switched off for this organisation
 *
 * This is convenience, not security: the API enforces the same rule with
 * requireModule(). Anyone who reaches a disabled screen by typing the URL gets
 * sent home rather than an empty page full of failed requests.
 */
export default function ModuleRoute({ module, children, redirectTo }) {
  const hasModule = useModuleStore((state) => state.hasModule);

  if (!hasModule(module)) {
    const userRole = localStorage.getItem("userRole");
    const fallback =
      redirectTo || (userRole === "user" ? "/user/profile" : "/dashboard");
    return <Navigate to={fallback} replace />;
  }

  return children;
}
