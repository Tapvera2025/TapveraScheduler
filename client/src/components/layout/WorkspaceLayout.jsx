import { useState, useEffect, useCallback } from "react";
import { Outlet, useLocation } from "react-router-dom";
import Sidebar from "./Sidebar";
import AgentPanel from "../agent/AgentPanel";
import VoiceAssistant from "../agent/VoiceAssistant";
import Navbar from "./Navbar";
import { companyApi } from "../../lib/api";
import { useCompanyStore } from "../../store/companyStore";

export default function WorkspaceLayout({ role = "admin" }) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const setOrganisation = useCompanyStore((state) => state.setOrganisation);
  const { pathname } = useLocation();
  const closeSidebar = useCallback(() => setSidebarOpen(false), []);
  useEffect(() => {
    if (role === "master") return;
    let cancelled = false;
    companyApi.getMine().then((res) => { if (!cancelled) setOrganisation(res.data.data); }).catch(() => {});
    return () => { cancelled = true; };
  }, [role, setOrganisation]);
  useEffect(() => {
    const media = window.matchMedia("(min-width: 1024px)");
    const onResize = () => { if (media.matches) closeSidebar(); };
    media.addEventListener("change", onResize);
    return () => media.removeEventListener("change", onResize);
  }, [closeSidebar]);
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return <div className="workspace-shell">
    <a href="#main-content" className="skip-link">Skip to content</a>
    <Sidebar role={role} isOpen={sidebarOpen} onClose={closeSidebar} collapsed={collapsed} onCollapse={() => setCollapsed((value) => !value)} />
    <div className="workspace-body">
      <Navbar role={role} onToggleSidebar={() => setSidebarOpen((value) => !value)} sidebarOpen={sidebarOpen} />
      <main id="main-content" className="workspace-main" tabIndex={-1}><Outlet /></main>
      <footer className="workspace-footer"><span>Tapvera Scheduler</span><span>A better rhythm for your team.</span></footer>
    </div>
    {/* Managers and admins only: the assistant acts under the signed-in user's
        own permissions, so it is never shown to someone who could not do the
        same thing by hand. */}
    {role === "admin" && <>
      <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} />
      <VoiceAssistant onOpenPanel={() => setAgentOpen(true)} />
    </>}
  </div>;
}
