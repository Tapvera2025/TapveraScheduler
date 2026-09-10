import { LayoutDashboard, CalendarDays, CalendarPlus, Clock3, ClipboardList, Fingerprint, Users, CalendarOff, MapPin, Building2, Settings2, UserRound, KeyRound } from "lucide-react";
import { MODULES } from "../../constants/modules";

export function getNavigation(role, hasModule = () => true) {
  const groups = role === "master" ? [
    { label: "PLATFORM", items: [
      { to: "/master", label: "Overview", icon: LayoutDashboard },
      { to: "/master/organisations", label: "Organisations", icon: Building2 },
    ] },
  ] : role === "employee" ? [
    { label: "MY WORKSPACE", items: [
      { to: "/user/roster", label: "My roster", icon: CalendarDays, module: MODULES.SCHEDULER },
      { to: "/user/clock", label: "Clock in & out", icon: Fingerprint, module: MODULES.ATTENDANCE },
      { to: "/user/history", label: "Time records", icon: ClipboardList, module: MODULES.ATTENDANCE },
      { to: "/user/leave", label: "My leave", icon: CalendarOff, module: MODULES.LEAVE },
      { to: "/user/adhoc", label: "Adhoc shifts", icon: CalendarPlus, module: MODULES.ADHOC },
    ] },
    { label: "ACCOUNT", items: [
      { to: "/user/profile", label: "My profile", icon: UserRound },
      { to: "/user/change-password", label: "Password & security", icon: KeyRound },
    ] },
  ] : [
    { label: "WORKSPACE", items: [
      { to: "/dashboard", label: "Overview", icon: LayoutDashboard },
      { to: "/scheduler", label: "Scheduler", icon: CalendarDays, module: MODULES.SCHEDULER },
      { to: "/scheduler/adhoc", label: "Adhoc requests", icon: CalendarPlus, module: MODULES.ADHOC },
      { to: "/attendance/records", label: "Time & attendance", icon: Clock3, module: MODULES.ATTENDANCE },
    ] },
    { label: "ORGANISATION", items: [
      { to: "/employees", label: "Employees management", icon: Users },
      { to: "/employees/leave", label: "Leave management", icon: CalendarOff, module: MODULES.LEAVE },
      { to: "/company/sites", label: "Sites & locations", icon: MapPin, module: MODULES.SITES },
      { to: "/company/clients", label: "Clients", icon: Building2, module: MODULES.CLIENTS },
    ] },
    { label: "PREFERENCES", items: [
      { to: "/settings", label: "Settings", icon: Settings2 },
    ] },
  ];
  return groups.map((group) => ({ ...group, items: group.items.filter((item) => !item.module || hasModule(item.module)) })).filter((group) => group.items.length);
}
