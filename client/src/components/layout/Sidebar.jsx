import { useRef } from "react";
import { NavLink, useNavigate } from "react-router-dom";
import { ArrowUpRight, Building2, LogOut, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { useModuleStore } from "../../store/moduleStore";
import { useCompanyStore } from "../../store/companyStore";
import { clearSession } from "../../lib/session";
import { useOverlay } from "../../hooks/useOverlay";
import { getNavigation } from "./navigation";
import Brand from "./Brand";
import ThemeToggle from "../ui/ThemeToggle";

export default function Sidebar({ isOpen, onClose, collapsed, onCollapse, role = "admin" }) {
  const navigate = useNavigate();
  const sidebarRef = useRef(null);
  const hasModule = useModuleStore((state) => state.hasModule);
  const organisation = useCompanyStore((state) => state.organisation);
  const groups = getNavigation(role, hasModule);
  useOverlay(isOpen, onClose, sidebarRef);
  const workspace = role === "master" ? "Platform administration" : organisation?.name || "Your organisation";
  const subtitle = role === "master" ? "Master workspace" : role === "employee" ? "Employee workspace" : "Management workspace";
  return <>
    {isOpen && <div className="sidebar-backdrop" onClick={onClose} aria-hidden="true" />}
    <aside id="workspace-navigation" ref={sidebarRef} tabIndex={-1} className={`workspace-sidebar ${isOpen ? "is-open" : ""} ${collapsed ? "is-collapsed" : ""}`} aria-label="Workspace navigation">
      <div className="sidebar-brand"><Brand /><button type="button" className="icon-button sidebar-close" onClick={onClose} aria-label="Close navigation"><X size={20} /></button></div>
      <div className="workspace-identity"><span className="workspace-identity-icon"><Building2 size={18} strokeWidth={1.6} /></span><div className="sidebar-label"><strong title={workspace}>{workspace}</strong><span>{subtitle}</span></div></div>
      <nav className="sidebar-nav">
        {groups.map((group) => <div className="nav-group" key={group.label}><p className="nav-group-label">{group.label}</p>
          {group.items.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} end={to !== "/master/organisations"} onClick={onClose} title={label} className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}>
            <Icon size={18} strokeWidth={1.7} /><span className="sidebar-label">{label}</span><span className="nav-active-dot" />
          </NavLink>)}
        </div>)}
      </nav>
      <div className="sidebar-footer">
        <div className="sidebar-appearance"><span className="eyebrow">APPEARANCE</span><ThemeToggle expanded /></div>
        <div className="sidebar-bottom"><button type="button" onClick={() => { clearSession(); navigate("/login", { replace: true }); }} className="sidebar-signout" title="Sign out"><LogOut size={17} /><span className="sidebar-label">Sign out</span><ArrowUpRight size={14} className="sidebar-label ml-auto" /></button>
          <button type="button" onClick={onCollapse} className="icon-button sidebar-collapse" aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}>{collapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}</button>
        </div>
      </div>
    </aside>
  </>;
}
