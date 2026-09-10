import { MobileTableSort } from "../ui/ResponsiveTable";
import { useState, useEffect } from 'react';
import { Calendar, CalendarDays, MapPin, Image as ImageIcon, Clock, ChevronLeft, ChevronRight, Filter, Loader2, Download, User } from 'lucide-react';
import { clockApi, schedulerApi, employeeApi } from '../../lib/api';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/Table';
import SortableHeader from '../ui/SortableHeader';
import { useTableSort } from '../../hooks/useTableSort';
import { formatDate as orgDate, formatTime as orgTime } from "../../lib/format";

export default function ManagerTimeRecords() {
  const [filtersOpen, setFiltersOpen] = useState(() => window.matchMedia('(min-width: 768px)').matches);
  const [loading, setLoading] = useState(true);
  const [records, setRecords] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 50, total: 0, pages: 0 });
  const [error, setError] = useState(null);
  const [exporting, setExporting] = useState(false);

  // Filters
  const [datePreset, setDatePreset] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedSite, setSelectedSite] = useState('');
  const [selectedEmployee, setSelectedEmployee] = useState('');
  const [sites, setSites] = useState([]);
  const [employees, setEmployees] = useState([]);

  // Photo viewer
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  useEffect(() => {
    fetchSites();
    fetchEmployees();
    fetchRecords();
  }, [pagination.page, datePreset, startDate, endDate, selectedSite, selectedEmployee]);

  /**
   * Quick ranges, kept from the screen this one replaced. A preset wins over
   * the two date boxes, and choosing one clears them, so the filter shown is
   * always the filter applied.
   */
  const presetRange = (preset) => {
    const now = new Date();
    const midnight = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const endOf = (d) => new Date(midnight(d).getTime() + 24 * 60 * 60 * 1000 - 1);

    if (preset === 'today') return [midnight(now), endOf(now)];
    if (preset === 'yesterday') {
      const y = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1);
      return [midnight(y), endOf(y)];
    }
    if (preset === 'this_week') {
      return [new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay()), now];
    }
    if (preset === 'last_week') {
      const first = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay() - 7);
      return [first, new Date(first.getTime() + 7 * 24 * 60 * 60 * 1000 - 1)];
    }
    if (preset === 'this_month') return [new Date(now.getFullYear(), now.getMonth(), 1), now];
    return null;
  };

  const fetchSites = async () => {
    try {
      const response = await schedulerApi.getSites();
      setSites(response.data.data || []);
    } catch (err) {
      console.error('Failed to fetch sites:', err);
    }
  };

  const fetchEmployees = async () => {
    try {
      const response = await employeeApi.getAll();
      // /employees returns { data: { employees, pagination } }, not a bare array
      const payload = response.data?.data;
      setEmployees(Array.isArray(payload) ? payload : payload?.employees || []);
    } catch (err) {
      console.error('Failed to fetch employees:', err);
    }
  };

  const fetchRecords = async () => {
    try {
      setLoading(true);
      setError(null);

      const params = {
        page: pagination.page,
        limit: pagination.limit,
      };

      const range = presetRange(datePreset);
      if (range) {
        params.startDate = range[0].toISOString();
        params.endDate = range[1].toISOString();
      } else {
        if (startDate) params.startDate = new Date(startDate).toISOString();
        if (endDate) params.endDate = new Date(endDate).toISOString();
      }
      if (selectedSite) params.siteId = selectedSite;
      if (selectedEmployee) params.employeeId = selectedEmployee;

      const response = await clockApi.getRecords(params);

      setRecords(response.data.data || []);
      setPagination(response.data.pagination || pagination);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to load time records');
      console.error('Failed to fetch records:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleExportCSV = async () => {
    try {
      setExporting(true);

      const params = {};
      const range = presetRange(datePreset);
      if (range) {
        params.startDate = range[0].toISOString();
        params.endDate = range[1].toISOString();
      } else {
        if (startDate) params.startDate = new Date(startDate).toISOString();
        if (endDate) params.endDate = new Date(endDate).toISOString();
      }
      if (selectedSite) params.siteId = selectedSite;
      if (selectedEmployee) params.employeeId = selectedEmployee;

      const response = await clockApi.exportCSV(params);

      // Create blob and download
      const blob = new Blob([response.data], { type: 'text/csv' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `time-records-${new Date().toISOString().split('T')[0]}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      setError(err.response?.data?.message || 'Failed to export CSV');
      console.error('Failed to export CSV:', err);
    } finally {
      setExporting(false);
    }
  };

  const handleClearFilters = () => {
    setDatePreset('');
    setStartDate('');
    setEndDate('');
    setSelectedSite('');
    setSelectedEmployee('');
    setPagination({ ...pagination, page: 1 });
  };

  const formatDate = (dateString) => orgDate(dateString, 'N/A');

  const formatTime = (dateString) => orgTime(dateString, 'N/A');

  const formatDuration = (hours) => {
    if (!hours) return 'N/A';
    const h = Math.floor(hours);
    const m = Math.round((hours - h) * 60);
    return `${h}h ${m}m`;
  };

  const { sortedData: sortedRecords, sortConfig, requestSort, getSortIndicator } = useTableSort(records, {
    defaultColumn: 'clockInTime',
    defaultDirection: 'desc',
  });

  const SORTABLE = [
    ['Employee', 'employeeId.firstName'],
    ['Date', 'clockInTime'],
    ['Site', 'siteId.siteLocationName'],
    ['Clock In', 'clockInTime'],
    ['Clock Out', 'clockOutTime'],
    ['Total Hours', 'totalHours'],
    ['Status', 'status'],
  ];

  // Calculate summary statistics
  const totalHours = records.reduce((sum, record) => sum + (record.totalHours || 0), 0);
  const clockedInCount = records.filter((record) => record.status === 'CLOCKED_IN').length;
  const activeFilterCount = [datePreset, startDate, endDate, selectedSite, selectedEmployee].filter(Boolean).length;

  return (
    <div className="attendance-page">
      <div className="attendance-page-shell">
        <header className="attendance-heading">
          <div>
            <p className="eyebrow">TEAM TIMEKEEPING</p>
            <h1>Time &amp; attendance<span>.</span></h1>
            <p>Review hours, activity, and clocking evidence across your team.</p>
          </div>
          <div className="attendance-heading-actions">
            <span className="date-chip"><CalendarDays size={15} />{orgDate(new Date())}</span>
            <button
              type="button"
              onClick={handleExportCSV}
              disabled={exporting || records.length === 0}
              className="solid-link"
            >
              {exporting ? <><Loader2 size={16} className="animate-spin" />Exporting...</> : <><Download size={16} />Export CSV</>}
            </button>
          </div>
        </header>

        <section className="attendance-dashboard-stats" aria-label="Attendance summary">
          <article className="stat-card stat-primary">
            <div className="stat-card-top"><span>Total records</span><Clock size={18} strokeWidth={1.5} /></div>
            <div className="stat-value">{String(pagination.total).padStart(2, '0')}</div>
            <div className="stat-card-bottom"><span>Matching your current view</span></div>
          </article>
          <article className="stat-card stat-success">
            <div className="stat-card-top"><span>On the clock</span><User size={18} strokeWidth={1.5} /></div>
            <div className="stat-value">{String(clockedInCount).padStart(2, '0')}</div>
            <div className="stat-card-bottom"><span>Active on this page</span></div>
          </article>
          <article className="stat-card stat-info">
            <div className="stat-card-top"><span>Hours logged</span><Calendar size={18} strokeWidth={1.5} /></div>
            <div className="stat-value">{totalHours.toFixed(1)}<small>h</small></div>
            <div className="stat-card-bottom"><span>Across this page of records</span></div>
          </article>
        </section>

        <div className="attendance-status-strip">
          <span className="status-strip-label">CURRENT VIEW</span>
          <span><i className="status-dot success" />{clockedInCount} clocked in</span>
          <span><i className="status-dot info" />{records.length} records on this page</span>
          {activeFilterCount > 0 && <span><i className="status-dot primary" />{activeFilterCount} filter{activeFilterCount === 1 ? '' : 's'} applied</span>}
        </div>

        <details className="attendance-filter-panel" open={filtersOpen} onToggle={event => setFiltersOpen(event.currentTarget.open)}>
          <summary>
            <span className="attendance-filter-summary">
              <span className="attendance-filter-symbol"><Filter size={17} strokeWidth={1.7} /></span>
              <span><strong>Refine records</strong><small>Set a date range, site, or employee.</small></span>
            </span>
            <span className="attendance-filter-state">{activeFilterCount ? `${activeFilterCount} active` : 'All records'}</span>
          </summary>

          <div className="attendance-filter-fields">
            {/* Quick range */}
            <div className="attendance-filter-field">
              <label>
                Quick range
              </label>
              <select
                value={datePreset}
                onChange={(e) => {
                  setDatePreset(e.target.value);
                  // A preset replaces the explicit dates rather than fighting them.
                  if (e.target.value) {
                    setStartDate('');
                    setEndDate('');
                  }
                  setPagination({ ...pagination, page: 1 });
                }}
                className="attendance-filter-control"
              >
                <option value="">Custom dates</option>
                <option value="today">Today</option>
                <option value="yesterday">Yesterday</option>
                <option value="this_week">This week</option>
                <option value="last_week">Last week</option>
                <option value="this_month">This month</option>
              </select>
            </div>

            {/* Start Date */}
            <div className="attendance-filter-field">
              <label>
                Start Date
              </label>
              <input
                type="date"
                value={startDate}
                disabled={Boolean(datePreset)}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  setPagination({ ...pagination, page: 1 });
                }}
                className="attendance-filter-control"
              />
            </div>

            {/* End Date */}
            <div className="attendance-filter-field">
              <label>
                End Date
              </label>
              <input
                type="date"
                value={endDate}
                disabled={Boolean(datePreset)}
                onChange={(e) => {
                  setEndDate(e.target.value);
                  setPagination({ ...pagination, page: 1 });
                }}
                className="attendance-filter-control"
              />
            </div>

            {/* Site Filter */}
            <div className="attendance-filter-field">
              <label>
                Site
              </label>
              <select
                value={selectedSite}
                onChange={(e) => {
                  setSelectedSite(e.target.value);
                  setPagination({ ...pagination, page: 1 });
                }}
                className="attendance-filter-control"
              >
                <option value="">All Sites</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.siteLocationName}
                  </option>
                ))}
              </select>
            </div>

            {/* Employee Filter */}
            <div className="attendance-filter-field">
              <label>
                Employee
              </label>
              <select
                value={selectedEmployee}
                onChange={(e) => {
                  setSelectedEmployee(e.target.value);
                  setPagination({ ...pagination, page: 1 });
                }}
                className="attendance-filter-control"
              >
                <option value="">All Employees</option>
                {employees.map((emp) => (
                  <option key={emp._id} value={emp._id}>
                    {emp.firstName} {emp.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {(datePreset || startDate || endDate || selectedSite || selectedEmployee) && (
            <div className="attendance-filter-actions">
              <button
                type="button"
                onClick={handleClearFilters}
                className="attendance-clear-filters"
              >
                Clear filters
              </button>
            </div>
          )}
        </details>

        {error && (
          <div className="attendance-feedback attendance-feedback-error" role="alert">
            <p>{error}</p>
          </div>
        )}

        {loading && (
          <div className="attendance-loading" aria-live="polite">
            <Loader2 size={22} className="animate-spin" />
            <span>Loading time records…</span>
          </div>
        )}

        {!loading && records.length > 0 && (
          <section className="attendance-records-card" aria-label="Team attendance records">
            <div className="attendance-records-heading">
              <div>
                <div className="panel-title-line"><h2>Clock records</h2><span className="subtle-pill">{pagination.total} total</span></div>
                <p>Each recorded shift, including clocking evidence.</p>
              </div>
              <span className="attendance-records-meta">Page {pagination.page} of {pagination.pages || 1}</span>
            </div>
            <MobileTableSort columns={SORTABLE.map(([label,key]) => [key,label])} sortConfig={sortConfig} onSort={requestSort} />
            <Table aria-label="Team attendance">
              <TableHeader>
                <TableRow>
                    {SORTABLE.map(([label, key]) => (
                    <TableHead key={label}>
                      <SortableHeader
                        label={label}
                        sortKey={key}
                        onSort={requestSort}
                        sortDirection={getSortIndicator(key)}
                      />
                    </TableHead>
                  ))}
                  <TableHead>Photos</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sortedRecords.map((record) => (
                  <TableRow key={record._id}>
                    {/* Employee */}
                    <TableCell data-label="Employee" data-field="title">
                      <div className="flex items-center gap-2">
                        <User className="w-4 h-4 text-[hsl(var(--color-foreground-muted))]" />
                        <span className="font-medium">
                          {record.employeeId?.firstName} {record.employeeId?.lastName}
                        </span>
                      </div>
                    </TableCell>

                    {/* Date */}
                    <TableCell data-label="Date">
                      <div className="flex items-center gap-2">
                        <Calendar className="w-4 h-4 text-[hsl(var(--color-foreground-muted))]" />
                        <span>{formatDate(record.clockInTime)}</span>
                      </div>
                    </TableCell>

                    {/* Site */}
                    <TableCell data-label="Site" data-field="wide">
                      <div className="flex items-center gap-2">
                        <MapPin className="w-4 h-4 text-[hsl(var(--color-foreground-muted))]" />
                        <span>{record.siteId?.siteLocationName || 'N/A'}</span>
                      </div>
                    </TableCell>

                    {/* Clock In */}
                    <TableCell data-label="Clock in">
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-[hsl(var(--color-success))]" />
                        <span>{formatTime(record.clockInTime)}</span>
                      </div>
                    </TableCell>

                    {/* Clock Out */}
                    <TableCell data-label="Clock out">
                      {record.clockOutTime ? (
                        <div className="flex items-center gap-2">
                          <Clock className="w-4 h-4 text-[hsl(var(--color-error))]" />
                          <span>{formatTime(record.clockOutTime)}</span>
                        </div>
                      ) : (
                        <span className="text-[hsl(var(--color-foreground-muted))]">-</span>
                      )}
                    </TableCell>

                    {/* Total Hours */}
                    <TableCell data-label="Total hours">
                      <span className="font-semibold text-[hsl(var(--color-info))]">
                        {formatDuration(record.totalHours)}
                      </span>
                    </TableCell>

                    {/* Status */}
                    <TableCell data-label="Status" data-field="status">
                      <span
                        className={`px-2 py-1 rounded-full text-xs font-medium ${
                          record.status === 'CLOCKED_IN'
                            ? 'bg-[hsl(var(--color-success-soft))] text-[hsl(var(--color-success))]'
                            : 'bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground))]'
                        }`}
                      >
                        {record.status === 'CLOCKED_IN' ? 'Active' : 'Completed'}
                      </span>
                    </TableCell>

                    {/* Photos */}
                    <TableCell data-label="Photos" data-field="actions">
                      <div className="flex items-center gap-2">
                        {record.clockInPhotoUrl && (
                          <button
                            onClick={() => setSelectedPhoto(record.clockInPhotoUrl)}
                            className="p-1 text-[hsl(var(--color-info))] hover:text-[hsl(var(--color-info))] hover:bg-[hsl(var(--color-info-soft))] rounded"
                            title="View Clock In Photo"
                          >
                            <ImageIcon className="w-4 h-4" /><span className="mobile-action-label">Clock in photo</span>
                          </button>
                        )}
                        {record.clockOutPhotoUrl && (
                          <button
                            onClick={() => setSelectedPhoto(record.clockOutPhotoUrl)}
                            className="p-1 text-[hsl(var(--color-error))] hover:text-[hsl(var(--color-error))] hover:bg-[hsl(var(--color-error-soft))] rounded"
                            title="View Clock Out Photo"
                          >
                            <ImageIcon className="w-4 h-4" /><span className="mobile-action-label">Clock out photo</span>
                          </button>
                        )}
                        {!record.clockInPhotoUrl && !record.clockOutPhotoUrl && (
                          <span className="text-[hsl(var(--color-foreground-muted))] text-sm">-</span>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="data-pagination attendance-records-pagination">
              <div>
                Showing {records.length} of {pagination.total} records
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setPagination({ ...pagination, page: pagination.page - 1 })}
                  disabled={pagination.page === 1}
                  className="attendance-pagination-button"
                  aria-label="Previous page"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>

                <span className="attendance-page-number">
                  Page {pagination.page} of {pagination.pages}
                </span>

                <button
                  type="button"
                  onClick={() => setPagination({ ...pagination, page: pagination.page + 1 })}
                  disabled={pagination.page >= pagination.pages}
                  className="attendance-pagination-button"
                  aria-label="Next page"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
          </section>
        )}

        {!loading && records.length === 0 && (
          <div className="attendance-empty-state">
            <span className="attendance-empty-symbol"><Clock size={27} strokeWidth={1.5} /></span>
            <h2>No time records found</h2>
            <p>
              {datePreset || startDate || endDate || selectedSite || selectedEmployee
                ? 'Try adjusting your filters to widen this view.'
                : 'Clock records will appear here as your team checks in and out.'}
            </p>
          </div>
        )}

        {/* Photo Viewer Modal */}
        {selectedPhoto && (
          <div
            className="fixed inset-0 bg-black/75 z-50 flex items-center justify-center p-4"
            onClick={() => setSelectedPhoto(null)}
          >
            <div className="relative max-w-4xl max-h-full">
              <img
                src={`http://localhost:5000${selectedPhoto}`}
                alt="Clock Photo"
                className="max-w-full max-h-[90vh] rounded-lg"
                onClick={(e) => e.stopPropagation()}
              />
              <button
                onClick={() => setSelectedPhoto(null)}
                className="absolute top-4 right-4 px-4 py-2 bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground))] rounded-lg font-medium hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
              >
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
