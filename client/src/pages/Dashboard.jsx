import { Link } from "react-router-dom";
import { ArrowUpRight, CalendarDays, ArrowRight } from "lucide-react";
import DashboardStats from "../components/dashboard/DashboardStats";
import AttendanceChart from "../components/dashboard/AttendanceChart";
import CoverageWidget from "../components/dashboard/CoverageWidget";
import LeaveRequestsWidget from "../components/dashboard/LeaveRequestsWidget";
import AdhocRequestsWidget from "../components/dashboard/AdhocRequestsWidget";
import { useAuthStore } from "../store/authStore";
import { useModuleStore } from "../store/moduleStore";
import { MODULES } from "../constants/modules";
import { formatDate } from "../lib/format";

export default function Dashboard() {
  const user = useAuthStore((state) => state.user);
  const hasModule = useModuleStore((state) => state.hasModule);
  const name = (user?.name || user?.firstName || user?.email?.split("@")[0] || "there").split(" ")[0];
  const hour = new Date().getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  return <div className="dashboard-page">
    <div className="dashboard-heading"><div><p className="eyebrow">YOUR DAY, AT A GLANCE</p><h1>{greeting}, {name}<span>.</span></h1><p>Here’s what’s happening across your team today.</p></div>
      <div className="dashboard-heading-actions"><span className="date-chip"><CalendarDays size={15} />{formatDate(new Date())}</span>{hasModule(MODULES.SCHEDULER) && <Link to="/scheduler" className="solid-link">Open scheduler<ArrowUpRight size={16} /></Link>}</div>
    </div>
    <DashboardStats />
    {hasModule(MODULES.ATTENDANCE) && <AttendanceChart />}
    <div className="dashboard-bottom-grid">
      <div className="dashboard-secondary-column">{hasModule(MODULES.SCHEDULER) && hasModule(MODULES.ATTENDANCE) && <CoverageWidget />}{hasModule(MODULES.ADHOC) && <AdhocRequestsWidget />}</div>
      {hasModule(MODULES.LEAVE) && <LeaveRequestsWidget />}
    </div>
    <div className="dashboard-shortcut"><div><span className="shortcut-mark">t.</span><div><strong>Good days start with a team in sync.</strong><p>Keep your people and their details up to date.</p></div></div><Link to="/employees">Manage your team<ArrowRight size={16} /></Link></div>
  </div>;
}
