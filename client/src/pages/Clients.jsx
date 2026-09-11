import PageHeader from "../components/layout/PageHeader";
import { useState, useRef, useEffect, useCallback } from "react";
import {
  Plus,
  ChevronDown,
  Maximize,
  Minimize,
  RotateCw,
  Building2,
} from "lucide-react";
import toast from "react-hot-toast";
import ClientsTable from "../components/clients/ClientsTable";
import ClientFilters from "../components/clients/ClientFilters";
import AddClientModal from "../components/clients/AddClientModal";
import AddMultipleClientsModal from "../components/clients/AddMultipleClientsModal";
import { clientApi } from "../lib/api";
import { useFullscreen } from "../hooks/useFullscreen";

export default function Clients() {
  const pageRef = useRef(null);
  const { isFullscreen, toggleFullscreen, isSupported } = useFullscreen(pageRef);

  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showAddClientModal, setShowAddClientModal] = useState(false);
  const [showMultipleClientsModal, setShowMultipleClientsModal] =
    useState(false);
  const [selectedClient, setSelectedClient] = useState(null);
  const addMenuRef = useRef(null);

  // Filter state
  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");

  // API state
  const [clients, setClients] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [currentLimit, setCurrentLimit] = useState(25);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });

  // Fetch clients function
  const fetchClients = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await clientApi.getAll({
        page: currentPage,
        limit: currentLimit,
        status: showInactive ? undefined : "ACTIVE",
        search,
      });

      const payload = response.data.data;
      setClients(Array.isArray(payload) ? payload : payload?.clients || []);
      setPagination(payload?.pagination || { total: Array.isArray(payload) ? payload.length : 0, pages: 1 });
    } catch (err) {
      setError(err.response?.data?.message || "Failed to fetch clients");
      setClients([]);
    } finally {
      setLoading(false);
    }
  }, [showInactive, currentPage, currentLimit, search]);

  // Re-fetch whenever filter or page changes
  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  // Handle refresh button
  const handleRefresh = () => {
    fetchClients();
    // Only show success if we're not using static data
    if (clients.length > 0) {
      toast.success("Refreshing clients...");
    }
  };

  // Handle client click to open edit modal
  const handleClientClick = (client) => {
    setSelectedClient(client);
    setShowAddClientModal(true);
  };

  // Handle close modal
  const handleCloseModal = () => {
    setShowAddClientModal(false);
    setShowMultipleClientsModal(false);
    setSelectedClient(null);
  };

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event) => {
      if (addMenuRef.current && !addMenuRef.current.contains(event.target)) {
        setAddMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div ref={pageRef} className="data-page">
      <PageHeader icon={Building2} title="Clients" eyebrow="YOUR WORKSPACE" description="Every client, with the details your team needs." actions={<>
        <button className="icon-button" onClick={handleRefresh} aria-label="Refresh clients"><RotateCw size={17} /></button>
        {isSupported && <button className="icon-button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
      </>} />

      {/* Content Section */}
      <div className="data-page-body">
        {/* Filter Section */}
        <div className="data-toolbar mb-4">
          <ClientFilters showInactive={showInactive} setShowInactive={value => { setCurrentPage(1); setShowInactive(value); }} search={search} onSearchChange={value => { setCurrentPage(1); setSearch(value); }} />
        </div>

        {/* Action Bar */}
        <div className="data-actionbar">
          {/* Primary Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative" ref={addMenuRef}>
              <button
                onClick={() => setAddMenuOpen(!addMenuOpen)}
                className="px-3 sm:px-4 py-2 bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] rounded-md hover:bg-[hsl(var(--color-primary))] transition-colors flex items-center gap-2 text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                <span>Add client</span>
                <ChevronDown className="w-4 h-4" />
              </button>

              {/* Add New Dropdown */}
              {addMenuOpen && (
                <div className="data-menu absolute left-0 top-full mt-1 w-48 z-50">
                  <button
                    onClick={() => {
                      setShowAddClientModal(true);
                      setAddMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
                  >
                    Client
                  </button>
                  <button
                    onClick={() => {
                      setShowMultipleClientsModal(true);
                      setAddMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
                  >
                    Multiple Clients
                  </button>
                </div>
              )}
            </div>
          </div>

          <label className="directory-page-size"><span>Per page</span><select aria-label="Records per page" value={currentLimit} onChange={(e) => { setCurrentPage(1); setCurrentLimit(Number(e.target.value)); }}>{[25,50,100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>

        {error && <div role="alert" className="stats-error">{error}<button onClick={handleRefresh}>Try again</button></div>}
        {/* Table */}
        <ClientsTable
          clients={clients}
          pagination={{ ...pagination, page: currentPage, limit: currentLimit }}
          onPageChange={setCurrentPage}
          loading={loading}
          onClientClick={handleClientClick}
        />
      </div>

      {/* Add Client Modal */}
      {showAddClientModal && (
        <AddClientModal
          client={selectedClient}
          onClose={handleCloseModal}
          onSuccess={fetchClients}
        />
      )}

      {/* Add Multiple Clients Modal */}
      {showMultipleClientsModal && (
        <AddMultipleClientsModal
          onClose={handleCloseModal}
          onSuccess={fetchClients}
        />
      )}
    </div>
  );
}
