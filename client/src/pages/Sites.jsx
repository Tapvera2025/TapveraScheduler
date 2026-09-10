import PageHeader from "../components/layout/PageHeader";
import { useState, useRef, useEffect } from "react";
import {
  Plus,
  ChevronDown,
  Maximize,
  Minimize,
  RotateCw,
  MapPin,
} from "lucide-react";
import toast from "react-hot-toast";
import SitesTable from "../components/sites/SitesTable";
import SiteFilters from "../components/sites/SiteFilters";
import AddSiteModal from "../components/sites/AddSiteModal";
import AddMultipleSitesModal from "../components/sites/AddMultipleSitesModal";
import MapModal from "../components/sites/MapModal";
import { siteApi } from "../lib/api";
import { useFullscreen } from "../hooks/useFullscreen";

export default function Sites() {
  const pageRef = useRef(null);
  const { isFullscreen, toggleFullscreen, isSupported } = useFullscreen(pageRef);

  const [showInactive, setShowInactive] = useState(false);
  const [search, setSearch] = useState("");
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [showAddSiteModal, setShowAddSiteModal] = useState(false);
  const [showMultipleSitesModal, setShowMultipleSitesModal] = useState(false);
  const [showMapModal, setShowMapModal] = useState(false);
  const [selectedSite, setSelectedSite] = useState(null);
  const addMenuRef = useRef(null);

  // API state
  const [sites, setSites] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [pagination, setPagination] = useState({
    page: 1,
    limit: 25,
    total: 0,
    totalPages: 0,
  });

  // Fetch sites function
  const fetchSites = async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await siteApi.getAll({
        status: showInactive ? undefined : "ACTIVE",
        search,
        page: pagination.page,
        limit: pagination.limit,
      });
      setSites(response.data.data.sites);
      setPagination(response.data.data.pagination);
    } catch (err) {
      setError(err.response?.data?.message || "Failed to fetch sites");
      toast.error("Failed to load sites");
    } finally {
      setLoading(false);
    }
  };

  // Fetch sites on mount and when filters change
  useEffect(() => {
    fetchSites();
  }, [showInactive, pagination.page, pagination.limit, search]);

  // Handle refresh button
  const handleRefresh = () => {
    fetchSites();
    toast.success("Sites refreshed");
  };

  // Handle site click to open edit modal
  const handleSiteClick = (site) => {
    setSelectedSite(site);
    setShowAddSiteModal(true);
  };

  // Handle map icon click to view site location
  const handleMapClick = (site) => {
    setSelectedSite(site);
    setShowMapModal(true);
  };

  // Handle close modal
  const handleCloseModal = () => {
    setShowAddSiteModal(false);
    setShowMultipleSitesModal(false);
    setShowMapModal(false);
    setSelectedSite(null);
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
      <PageHeader icon={MapPin} title="Sites" eyebrow="YOUR WORKSPACE" description="Your locations, connected to the people who work there." actions={<>
        <button className="icon-button" onClick={handleRefresh} aria-label="Refresh sites"><RotateCw size={17} /></button>
        {isSupported && <button className="icon-button" onClick={toggleFullscreen} aria-label={isFullscreen ? "Exit fullscreen" : "Enter fullscreen"}>{isFullscreen ? <Minimize size={17} /> : <Maximize size={17} />}</button>}
      </>} />

      {/* Content Section */}
      <div className="data-page-body">
        {/* Filter Section */}
        <div className="data-toolbar mb-4">
          <SiteFilters
            showInactive={showInactive}
            setShowInactive={value => { setPagination(prev => ({ ...prev, page: 1 })); setShowInactive(value); }}
            search={search}
            onSearchChange={value => { setPagination(prev => ({ ...prev, page: 1 })); setSearch(value); }}
          />
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
                <span>Add site</span>
                <ChevronDown className="w-4 h-4" />
              </button>

              {/* Add New Dropdown */}
              {addMenuOpen && (
                <div className="data-menu absolute left-0 top-full mt-1 w-48 z-50">
                  <button
                    onClick={() => {
                      setShowAddSiteModal(true);
                      setAddMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
                  >
                    Site
                  </button>
                  <button
                    onClick={() => {
                      setShowMultipleSitesModal(true);
                      setAddMenuOpen(false);
                    }}
                    className="w-full text-left px-4 py-2 text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
                  >
                    Multiple Sites
                  </button>
                </div>
              )}
            </div>
          </div>

          <label className="directory-page-size"><span>Per page</span><select aria-label="Records per page" value={pagination.limit} onChange={(e) => setPagination(prev => ({ ...prev, page: 1, limit: Number(e.target.value) }))}>{[25,50,100].map(n => <option key={n} value={n}>{n}</option>)}</select></label>
        </div>

        {error && <div role="alert" className="stats-error">{error}<button onClick={handleRefresh}>Try again</button></div>}
        {/* Table */}
        <SitesTable
          sites={sites}
          loading={loading}
          pagination={pagination}
          onPageChange={page => setPagination(prev => ({ ...prev, page }))}
          onSiteClick={handleSiteClick}
          onMapClick={handleMapClick}
        />
      </div>

      {/* Add Site Modal */}
      {showAddSiteModal && (
        <AddSiteModal
          site={selectedSite}
          onClose={handleCloseModal}
          onSuccess={() => {
            fetchSites();
            toast.success(
              selectedSite
                ? "Site updated successfully"
                : "Site created successfully",
            );
          }}
        />
      )}

      {/* Add Multiple Sites Modal */}
      {showMultipleSitesModal && (
        <AddMultipleSitesModal
          onClose={handleCloseModal}
          onSuccess={() => {
            fetchSites();
            toast.success("Sites created successfully");
          }}
        />
      )}

      {/* View Site Location Modal */}
      {showMapModal && selectedSite && (
        <MapModal
          onClose={handleCloseModal}
          initLatitude={selectedSite.latitude}
          initLongitude={selectedSite.longitude}
          initAddress={selectedSite.address}
          initState={selectedSite.state}
          initTownSuburb={selectedSite.townSuburb}
          initPostalCode={selectedSite.postalCode}
          initGeoFenceRadius={selectedSite.geoFenceRadius}
        />
      )}
    </div>
  );
}
