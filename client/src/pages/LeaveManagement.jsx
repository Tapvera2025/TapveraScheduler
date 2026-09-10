import { useState, useEffect, useCallback } from "react";
import { CalendarDays, Plus, RotateCcw, Search, X } from "lucide-react";
import LeaveStats from "../components/leave/LeaveStats";
import LeaveTable from "../components/leave/LeaveTable";
import AddLeaveModal from "../components/leave/AddLeaveModal";
import { Input } from "../components/ui/Input";
import { Button } from "../components/ui/Button";
import { Select } from "../components/ui/Select";
import { leaveApi } from "../lib/api";
import { formatDate } from "../lib/format";
import toast from "react-hot-toast";

const STATUS_OPTIONS = [
  ["all", "All"],
  ["pending", "Pending"],
  ["approved", "Approved"],
  ["declined", "Declined"],
  ["cancelled", "Cancelled"],
];

const initialFilters = { leavePeriod: "all", leaveCategory: "all", status: "all" };

function getPeriodRange(period) {
  const now = new Date();
  const endOfDay = (date) => new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59, 999);
  const currentMonth = now.getMonth();
  const currentYear = now.getFullYear();
  const endOfCurrentMonth = endOfDay(new Date(currentYear, currentMonth + 1, 0));

  switch (period) {
    case "current_prev_month":
      return { startDate: new Date(currentYear, currentMonth - 1, 1), endDate: endOfCurrentMonth };
    case "current_month":
      return { startDate: new Date(currentYear, currentMonth, 1), endDate: endOfCurrentMonth };
    case "last_3_months":
      return { startDate: new Date(currentYear, currentMonth - 2, 1), endDate: endOfCurrentMonth };
    case "last_6_months":
      return { startDate: new Date(currentYear, currentMonth - 5, 1), endDate: endOfCurrentMonth };
    case "this_year":
      return { startDate: new Date(currentYear, 0, 1), endDate: endOfDay(new Date(currentYear, 11, 31)) };
    default:
      return null;
  }
}

export default function LeaveManagement() {
  const [filters, setFilters] = useState(initialFilters);
  const [searchQuery, setSearchQuery] = useState("");
  const [showAddModal, setShowAddModal] = useState(false);
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [currentPage, setCurrentPage] = useState(1);
  const [leaves, setLeaves] = useState([]);
  const [stats, setStats] = useState({ total: 0, pending: 0, approved: 0, declined: 0, cancelled: 0 });
  const [loading, setLoading] = useState(false);
  const [pagination, setPagination] = useState({ total: 0, pages: 1 });

  const fetchData = useCallback(async () => {
    try {
      setLoading(true);
      const params = { page: currentPage, limit: itemsPerPage };
      const period = getPeriodRange(filters.leavePeriod);

      if (filters.leaveCategory !== "all") params.leaveType = filters.leaveCategory;
      if (filters.status !== "all") params.status = filters.status;
      if (period) {
        params.startDate = period.startDate.toISOString();
        params.endDate = period.endDate.toISOString();
      }

      const [leavesRes, statsRes] = await Promise.all([leaveApi.getAll(params), leaveApi.getStats()]);

      setLeaves(leavesRes.data.data.leaves || []);
      setPagination(leavesRes.data.data.pagination || { total: 0, pages: 1 });
      setStats(statsRes.data.data || { total: 0, pending: 0, approved: 0, declined: 0, cancelled: 0 });
    } catch {
      toast.error("Failed to load leave requests");
    } finally {
      setLoading(false);
    }
  }, [currentPage, itemsPerPage, filters]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const updateFilter = (key, value) => {
    setFilters((current) => ({ ...current, [key]: value }));
    setCurrentPage(1);
  };

  const clearFilters = () => {
    setFilters(initialFilters);
    setCurrentPage(1);
  };

  const displayed = searchQuery
    ? leaves.filter((leave) => {
        const employee = leave.employeeId;
        const name = employee ? `${employee.firstName} ${employee.lastName}`.toLowerCase() : "";
        return name.includes(searchQuery.toLowerCase());
      })
    : leaves;

  const activeFilterCount = Object.values(filters).filter((value) => value !== "all").length;

  return (
    <div className="leave-page">
      <div className="leave-page-shell">
        <header className="leave-heading">
          <div>
            <p className="eyebrow">TIME FOR YOUR TEAM</p>
            <h1>Leave management<span>.</span></h1>
            <p>Review requests, make decisions, and keep team cover in view.</p>
          </div>
          <div className="leave-heading-actions">
            <span className="date-chip"><CalendarDays size={15} />{formatDate(new Date())}</span>
            <button type="button" className="icon-button leave-refresh-button" onClick={fetchData} aria-label="Refresh leave requests">
              <RotateCcw size={17} className={loading ? "animate-spin" : ""} />
            </button>
            <button type="button" className="solid-link" onClick={() => setShowAddModal(true)}>
              <Plus size={16} />Add leave
            </button>
          </div>
        </header>

        <LeaveStats stats={stats} />

        <section className="leave-command-bar" aria-label="Leave request filters">
          <div className="leave-search">
            <Search size={16} aria-hidden="true" />
            <Input
              type="search"
              placeholder="Search employee"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              aria-label="Search leave requests by employee"
              className="pl-10"
            />
          </div>

          <div className="leave-status-filter">
            <span className="leave-filter-label">Status</span>
            <div className="leave-status-tags" role="group" aria-label="Filter by leave status">
              {STATUS_OPTIONS.map(([value, label]) => (
                <button
                  type="button"
                  key={value}
                  className={`leave-status-tag ${filters.status === value ? "is-active" : ""}`}
                  aria-pressed={filters.status === value}
                  onClick={() => updateFilter("status", value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <div className="leave-dropdown-filters">
            <label className="leave-dropdown-label">
              <span>Period</span>
              <Select value={filters.leavePeriod} onChange={(event) => updateFilter("leavePeriod", event.target.value)} aria-label="Leave period">
                <option value="all">All time</option>
                <option value="current_prev_month">Current &amp; previous month</option>
                <option value="current_month">Current month</option>
                <option value="last_3_months">Last 3 months</option>
                <option value="last_6_months">Last 6 months</option>
                <option value="this_year">This year</option>
              </Select>
            </label>
            <label className="leave-dropdown-label">
              <span>Type</span>
              <Select value={filters.leaveCategory} onChange={(event) => updateFilter("leaveCategory", event.target.value)} aria-label="Leave type">
                <option value="all">All types</option>
                <option value="annual">Annual leave</option>
                <option value="sick">Sick leave</option>
                <option value="personal">Personal leave</option>
                <option value="unpaid">Unpaid leave</option>
              </Select>
            </label>
          </div>

          {activeFilterCount > 0 && (
            <button type="button" className="leave-clear-filters" onClick={clearFilters}>
              <X size={14} />Clear filters
            </button>
          )}
        </section>

        <section className="leave-records-card" aria-label="Leave requests">
          <header className="leave-records-heading">
            <div>
              <div className="panel-title-line"><h2>Leave requests</h2><span className="subtle-pill">{pagination.total} total</span></div>
              <p>{activeFilterCount ? `${activeFilterCount} filter${activeFilterCount === 1 ? "" : "s"} applied to this view.` : "All requests across your team."}</p>
            </div>
            <label className="leave-rows-control">
              <span>Rows</span>
              <Select
                value={itemsPerPage}
                onChange={(event) => { setItemsPerPage(Number(event.target.value)); setCurrentPage(1); }}
                aria-label="Rows per page"
              >
                <option value={10}>10</option>
                <option value={25}>25</option>
                <option value={50}>50</option>
                <option value={100}>100</option>
              </Select>
            </label>
          </header>

          {loading ? (
            <div className="leave-loading" aria-live="polite"><RotateCcw size={20} className="animate-spin" />Loading leave requests…</div>
          ) : (
            <LeaveTable leaveRequests={displayed} onRefresh={fetchData} />
          )}

          {!loading && (
            <footer className="data-pagination leave-pagination">
              <span>
                {pagination.total > 0
                  ? `Showing ${Math.min((currentPage - 1) * itemsPerPage + 1, pagination.total)}–${Math.min(currentPage * itemsPerPage, pagination.total)} of ${pagination.total}`
                  : "No records"}
              </span>
              <div>
                <Button variant="outline" size="sm" disabled={currentPage <= 1} onClick={() => setCurrentPage((page) => page - 1)}>Previous</Button>
                <span className="leave-page-number">Page {currentPage} of {pagination.pages || 1}</span>
                <Button variant="outline" size="sm" disabled={currentPage >= pagination.pages} onClick={() => setCurrentPage((page) => page + 1)}>Next</Button>
              </div>
            </footer>
          )}
        </section>
      </div>

      <AddLeaveModal open={showAddModal} onClose={() => setShowAddModal(false)} onSuccess={fetchData} />
    </div>
  );
}
