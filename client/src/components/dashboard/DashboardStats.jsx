import { useState, useEffect, useCallback } from "react";
import { CalendarDays, Users, ClipboardList, Clock3, ArrowUpRight, CircleAlert } from "lucide-react";
import { Link } from "react-router-dom";
import { dashboardApi } from "../../lib/api";
import { useModuleStore } from "../../store/moduleStore";
import { MODULES } from "../../constants/modules";
import { useSocketEvent } from "../../contexts/SocketContext";

export default function DashboardStats() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const hasModule = useModuleStore((state) => state.hasModule);
  const fetchStats = useCallback(async () => {
    try { setLoading(true); setError(false); const res = await dashboardApi.getStats(); setData(res.data.data); }
    catch { setError(true); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { fetchStats(); }, [fetchStats]);
  useSocketEvent('clock-in', fetchStats);
  useSocketEvent('clock-out', fetchStats);
  const fmt = (value) => loading || error ? "—" : String(value ?? 0).padStart(2, "0");
  const stats = [
    { label: "Active people", value: data?.activeEmployees, icon: Users, detail: "Your team, ready to work", to: "/employees", tone: "neutral" },
    { label: "Clocked in now", value: data?.clockedInNow, icon: Clock3, detail: "Currently on the clock", to: "/attendance/records", tone: "success", module: MODULES.ATTENDANCE },
    { label: "Open shifts", value: data?.openShifts, icon: CalendarDays, detail: "Ready to be assigned", to: "/scheduler", tone: "primary", module: MODULES.SCHEDULER },
    { label: "Leave requests", value: data?.leaveRequests, icon: ClipboardList, detail: "Keep time off in view", to: "/employees/leave", tone: "info", module: MODULES.LEAVE },
  ].filter((item) => !item.module || hasModule(item.module));
  return <section aria-label="Team overview" aria-busy={loading}>
    {error && <div className="stats-error" role="alert"><CircleAlert size={15} />We couldn’t load your overview.<button onClick={fetchStats}>Try again</button></div>}
    <div className="dashboard-stats-grid">
      {stats.map(({ label, value, icon: Icon, detail, to, tone }) => <Link key={label} to={to} className={`stat-card stat-${tone}`}>
        <div className="stat-card-top"><span>{label}</span><Icon size={18} strokeWidth={1.5} /></div><div className="stat-value">{fmt(value)}</div><div className="stat-card-bottom"><span>{detail}</span><ArrowUpRight size={14} /></div>
      </Link>)}
    </div>
    {(hasModule(MODULES.SCHEDULER) || hasModule(MODULES.ATTENDANCE)) && <div className="dashboard-status-strip"><span className="status-strip-label">ON YOUR RADAR</span>
      {hasModule(MODULES.SCHEDULER) && <><Link to="/scheduler"><span className="status-dot warning" /><strong>{fmt(data?.tentativeShifts)}</strong> tentative shifts</Link><Link to="/scheduler"><span className="status-dot neutral" /><strong>{fmt(data?.unpublishedShifts)}</strong> unpublished</Link></>}
      {hasModule(MODULES.ATTENDANCE) && <Link to="/attendance/time"><span className="status-dot error" /><strong>{fmt(data?.noShowAbsent)}</strong> absent / no show</Link>}
    </div>}
  </section>;
}
