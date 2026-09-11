import { useState, useEffect, useRef, useCallback } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { Search, ChevronDown, ChevronRight, LogOut, UserRound, Menu, X, ArrowUpRight, Command } from "lucide-react";
import NotificationBell from "../notifications/NotificationBell";
import ThemeToggle from "../ui/ThemeToggle";
import { clearSession } from "../../lib/session";
import { useModuleStore } from "../../store/moduleStore";
import { useOverlay } from "../../hooks/useOverlay";
import { getNavigation } from "./navigation";

export default function Navbar({ onToggleSidebar, sidebarOpen = false, role = "admin" }) {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [query, setQuery] = useState("");
  const searchRef = useRef(null);
  const menuRef = useRef(null);
  const closeSearch = useCallback(() => setSearchOpen(false), []);
  useOverlay(searchOpen, closeSearch, searchRef);
  const hasModule = useModuleStore((state) => state.hasModule);
  const routes = getNavigation(role, hasModule).flatMap((group) => group.items);
  const current = routes.find((item) => item.to === pathname) || [...routes].reverse().find((item) => pathname.startsWith(item.to));
  const userName = localStorage.getItem("userName") || "Your account";
  const userEmail = localStorage.getItem("userEmail") || "";
  const userRole = (localStorage.getItem("userRole") || "user").toLowerCase();
  const roleLabel = { admin: "Administrator", manager: "Manager", master: "Platform admin", user: "Team member" }[userRole] || "Team member";
  const initials = userName.split(" ").filter(Boolean).map((n) => n[0]).join("").slice(0, 2).toUpperCase();
  const profilePath = role === "employee" ? "/user/profile" : "/profile";
  useEffect(() => {
    const key = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setSearchOpen((open) => !open); }
      if (event.key === "Escape") setUserMenuOpen(false);
    };
    const outside = (event) => { if (!menuRef.current?.contains(event.target)) setUserMenuOpen(false); };
    document.addEventListener("keydown", key);
    document.addEventListener("pointerdown", outside);
    return () => { document.removeEventListener("keydown", key); document.removeEventListener("pointerdown", outside); };
  }, []);
  const matches = routes.filter((route) => route.label.toLowerCase().includes(query.toLowerCase()));
  return <>
    <header className="workspace-topbar">
      <div className="topbar-leading"><button type="button" className="icon-button mobile-menu-toggle" onClick={onToggleSidebar} aria-label="Open navigation" aria-expanded={sidebarOpen} aria-controls="workspace-navigation"><Menu size={20} /></button>
        <div className="workspace-breadcrumb"><span>{role === "master" ? "Platform" : role === "employee" ? "My workspace" : "Workspace"}</span><ChevronRight size={13} /><strong>{current?.label || (pathname.includes("password") ? "Password & security" : "My profile")}</strong></div>
      </div>
      <div className="topbar-actions">
        <button type="button" className="workspace-search" onClick={() => { setQuery(""); setSearchOpen(true); }} aria-label="Search pages"><Search size={16} /><span>Jump to…</span><kbd><Command size={11} /> K</kbd></button>
        <ThemeToggle />
        {role !== "master" && <NotificationBell />}
        <span className="topbar-divider" />
        <div className="relative" ref={menuRef}>
          <button type="button" onClick={() => setUserMenuOpen((open) => !open)} className="account-trigger" aria-label="Account menu" aria-expanded={userMenuOpen}>
            <span className="account-avatar">{initials}</span><span className="account-label"><strong>{userName}</strong><span>{roleLabel}</span></span><ChevronDown size={14} className="account-chevron" />
          </button>
          {userMenuOpen && <div className="account-menu">
            <div className="account-menu-heading"><strong>{userName}</strong><span>{userEmail}</span></div>
            {role !== "master" && <Link to={profilePath} onClick={() => setUserMenuOpen(false)}><UserRound size={16} />My profile<ArrowUpRight size={14} className="ml-auto" /></Link>}
            <button type="button" onClick={() => { clearSession(); navigate("/login", { replace: true }); }}><LogOut size={16} />Sign out</button>
          </div>}
        </div>
      </div>
    </header>
    {searchOpen && <div className="command-overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) closeSearch(); }}>
      <section className="command-dialog" ref={searchRef} role="dialog" aria-modal="true" aria-label="Jump to a page" tabIndex={-1}>
        <div className="command-input"><Search size={20} /><input autoFocus placeholder="Where would you like to go?" aria-label="Search pages" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && matches[0]) { navigate(matches[0].to); closeSearch(); } }} /><button className="icon-button" onClick={closeSearch} aria-label="Close search"><X size={18} /></button></div>
        <div className="command-results"><p className="eyebrow">PAGES</p>{matches.map(({ to, label, icon: Icon }) => <Link key={to} to={to} onClick={closeSearch}><Icon size={18} />{label}<ArrowUpRight size={15} /></Link>)}{!matches.length && <p className="command-empty">No pages found. Try another name.</p>}</div>
        <div className="command-footer">Find your way around your workspace <kbd>esc to close</kbd></div>
      </section>
    </div>}
  </>;
}
