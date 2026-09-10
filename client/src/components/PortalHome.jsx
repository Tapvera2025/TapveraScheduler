import { Navigate } from "react-router-dom";
import { useModuleStore } from "../store/moduleStore";
import { MODULES } from "../constants/modules";

/**
 * PortalHome - sends an employee to the first portal screen their organisation has
 *
 * Without this, /user always redirected to the roster, which is a dead end when
 * the scheduler module is switched off.
 */
export default function PortalHome() {
  const hasModule = useModuleStore((state) => state.hasModule);

  if (hasModule(MODULES.SCHEDULER)) return <Navigate to="/user/roster" replace />;
  if (hasModule(MODULES.ATTENDANCE)) return <Navigate to="/user/clock" replace />;
  if (hasModule(MODULES.LEAVE)) return <Navigate to="/user/leave" replace />;
  if (hasModule(MODULES.ADHOC)) return <Navigate to="/user/adhoc" replace />;

  return <Navigate to="/user/profile" replace />;
}
