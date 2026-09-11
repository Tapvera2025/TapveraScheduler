import ResponsiveTable from "../ui/ResponsiveTable";
import { useState, useEffect, useCallback, useRef } from "react";
import { Select } from "../ui/Select";
import { Button } from "../ui/Button";
import { ChevronLeft, ChevronRight, RotateCw } from "lucide-react";
import { dashboardApi } from "../../lib/api";
import { useSocketEvent } from "../../contexts/SocketContext";

function LiveElapsed({ clockInTimestamp, breakMins }) {
  const [display, setDisplay] = useState('');
  useEffect(() => {
    const tick = () => {
      const elapsedMs = Math.max(0, Date.now() - new Date(clockInTimestamp) - (breakMins || 0) * 60000);
      const h = Math.floor(elapsedMs / 3600000);
      const m = Math.floor((elapsedMs % 3600000) / 60000);
      setDisplay(`${h}h ${m}m`);
    };
    tick();
    const id = setInterval(tick, 60000);
    return () => clearInterval(id);
  }, [clockInTimestamp, breakMins]);
  return <span className="text-[hsl(var(--color-success))] font-medium">{display}</span>;
}

export default function AttendanceChart() {
  const [viewMode, setViewMode] = useState("shift");
  const [chartType, setChartType] = useState("bar");
  const [itemsPerPage, setItemsPerPage] = useState(25);
  const [page, setPage] = useState(1);

  const [attendanceRecords, setAttendanceRecords] = useState([]);
  const [loading, setLoading] = useState(false);

  const fetchAttendance = useCallback(async () => {
    try {
      setLoading(true);
      const res = await dashboardApi.getAttendance();
      setAttendanceRecords(res.data.data || []);
    } catch {
      setAttendanceRecords([]);
    } finally {
      setLoading(false);
    }
  }, []);

  // Fetch on mount and auto-refresh every 60 seconds
  useEffect(() => {
    fetchAttendance();
    const interval = setInterval(fetchAttendance, 60000);
    return () => clearInterval(interval);
  }, [fetchAttendance]);

  // Re-fetch on any clock/break event
  useSocketEvent('clock-in', fetchAttendance);
  useSocketEvent('clock-out', fetchAttendance);
  useSocketEvent('break-start', fetchAttendance);
  useSocketEvent('break-end', fetchAttendance);

  const formatTime = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("en-AU", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  const formatDate = (iso) => {
    if (!iso) return "—";
    return new Date(iso).toLocaleDateString("en-AU", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
    });
  };

  const getStatusBadge = (status) => {
    const styles = {
      CLOCKED_IN:  "bg-[hsl(var(--color-success-soft))] text-[hsl(var(--color-success))]",
      CLOCKED_OUT: "bg-[hsl(var(--color-primary-soft))] text-[hsl(var(--color-primary))]",
      NO_SHOW:     "bg-[hsl(var(--color-error-soft))] text-[hsl(var(--color-error))]",
    };
    return styles[status] || "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground))]";
  };

  const formatStatus = (status) => {
    const labels = {
      CLOCKED_IN:  "Clocked In",
      CLOCKED_OUT: "Clocked Out",
      NO_SHOW:     "No Show",
    };
    return labels[status] || status?.replace(/_/g, " ") || "—";
  };

  // Derived stats
  const workingCount    = attendanceRecords.filter((r) => r.status === "CLOCKED_IN").length;
  const clockedOut      = attendanceRecords.filter((r) => r.status === "CLOCKED_OUT").length;
  const noShowCount     = attendanceRecords.filter((r) => r.status === "NO_SHOW").length;
  const totalShifts     = attendanceRecords.length;
  const lateCount       = attendanceRecords.filter((r) => r.isLate).length;
  const earlyLeaveCount = attendanceRecords.filter((r) => r.isEarlyLeave).length;
  const onBreakCount    = attendanceRecords.filter((r) => r.onBreak).length;

  // Pagination
  const totalPages  = Math.max(1, Math.ceil(totalShifts / itemsPerPage));
  const startIdx    = (page - 1) * itemsPerPage;
  const pagedRecords = attendanceRecords.slice(startIdx, startIdx + itemsPerPage);

  const attendanceData = [
    { label: "Working",             value: workingCount,    color: "bg-[hsl(var(--color-primary))]" },
    { label: "No Show",             value: noShowCount,     color: "bg-[hsl(var(--color-error))]" },
    { label: "Clocked Out",         value: clockedOut,      color: "bg-[hsl(var(--color-success))]" },
    { label: "No Activity",         value: 0,               color: "bg-[hsl(var(--color-border-strong))]" },
    { label: "Late Arrival",        value: lateCount,       color: "bg-[hsl(var(--color-warning))]" },
    { label: "Early Leave",         value: earlyLeaveCount, color: "bg-[hsl(var(--color-warning))]" },
    { label: "Left Job Site",       value: 0,               color: "bg-[hsl(var(--color-primary))]" },
    { label: "Outside Job Site",    value: 0,               color: "bg-[hsl(var(--color-primary))]" },
  ];

  const maxVal = Math.max(...attendanceData.map((d) => d.value), 1);

  const summaryStats = [
    { label: "Currently Working",     value: workingCount },
    { label: "No Show",               value: noShowCount },
    { label: "Clocked Out (Done)",    value: clockedOut },
    { label: "No Activity",           value: 0 },
    { label: "Late Arrival",          value: lateCount },
    { label: "Early Leave",           value: earlyLeaveCount },
    { label: "On Break",              value: onBreakCount },
    { label: "Left Job Site",         value: 0 },
    { label: "Outside Job Site",      value: 0 },
    { label: "Total Scheduled Shifts", value: totalShifts },
    { label: "Total Worked Shifts",   value: clockedOut },
  ];

  const liveAttendanceColumns = [
    "Date", "Employee", "Mobile", "Site",
    "Shift Time", "HRS", "In", "Out", "Break", "Total HRS", "Status",
  ];

  // ── Live Attendance Table ──────────────────────────────────────────────────
  const renderLiveAttendance = () => (
    <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-3xl shadow-sm overflow-hidden">
      {/* Toolbar */}
      <div className="border-b border-[hsl(var(--color-border))] px-4 py-3 flex flex-wrap gap-3 items-center justify-between">
        <div className="flex items-center gap-3">
          <span className="text-sm font-medium text-[hsl(var(--color-foreground-secondary))]">Today</span>
          <div className="flex items-center gap-1.5 text-xs text-[hsl(var(--color-foreground-secondary))]">
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--color-success))] inline-block" /> Clocked In: {workingCount}
            </span>
            <span className="mx-1">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--color-primary))] inline-block" /> Clocked Out: {clockedOut}
            </span>
            <span className="mx-1">·</span>
            <span className="inline-flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--color-error))] inline-block" /> No Show: {noShowCount}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={fetchAttendance}
            className="p-1.5 hover:bg-[hsl(var(--color-surface-elevated))] rounded transition-colors"
            title="Refresh"
          >
            <RotateCw className={`w-4 h-4 text-[hsl(var(--color-foreground-secondary))] ${loading ? "animate-spin" : ""}`} />
          </button>
          <Select
            value={itemsPerPage}
            onChange={(e) => { setItemsPerPage(Number(e.target.value)); setPage(1); }}
            className="w-20"
          >
            <option value={10}>10</option>
            <option value={25}>25</option>
            <option value={50}>50</option>
            <option value={100}>100</option>
          </Select>
        </div>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <ResponsiveTable className="w-full">
          <thead role="rowgroup" className="bg-[hsl(var(--color-surface-elevated))] border-b border-[hsl(var(--color-border))]">
            <tr role="row">
              <th role="columnheader" scope="col" className="px-4 py-3 text-center text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider border-r border-[hsl(var(--color-border))]" colSpan="4" />
              <th role="columnheader" scope="col" className="px-4 py-3 text-center text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider border-r border-[hsl(var(--color-border))]" colSpan="2">
                Shift Assignment
              </th>
              <th role="columnheader" scope="col" className="px-4 py-3 text-center text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider border-r border-[hsl(var(--color-border))]" colSpan="4">
                Clocked Record
              </th>
              <th role="columnheader" scope="col" className="px-4 py-3 text-center text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider" />
            </tr>
            <tr role="row" className="bg-[hsl(var(--color-surface-elevated))]">
              {liveAttendanceColumns.map((col) => (
                <th role="columnheader" scope="col"
                  key={col}
                  className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap"
                >
                  {col}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="divide-y divide-[hsl(var(--color-border))]">
            {loading ? (
              <tr role="row">
                <td role="cell" colSpan={liveAttendanceColumns.length} className="px-4 py-12 text-center text-sm text-[hsl(var(--color-foreground-muted))]">
                  <div className="flex items-center justify-center gap-2">
                    <RotateCw className="w-4 h-4 animate-spin" />
                    Loading attendance data…
                  </div>
                </td>
              </tr>
            ) : pagedRecords.length === 0 ? (
              <tr role="row">
                <td role="cell" colSpan={liveAttendanceColumns.length} className="px-4 py-12 text-center text-sm text-[hsl(var(--color-foreground-muted))]">
                  No shifts scheduled for today
                </td>
              </tr>
            ) : (
              pagedRecords.map((record) => (
                <tr role="row" key={record.id} className="hover:bg-[hsl(var(--color-surface-elevated))] transition-colors">
                  <td role="cell" data-label="Date" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {formatDate(record.date)}
                  </td>
                  <td role="cell" data-label="Employee" data-field="title" className="px-4 py-3 text-sm font-medium text-[hsl(var(--color-foreground))] whitespace-nowrap">
                    {record.employee}
                  </td>
                  <td role="cell" data-label="Mobile" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {record.mobile}
                  </td>
                  <td role="cell" data-label="Site" data-field="wide" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {record.site}
                  </td>
                  <td role="cell" data-label="Scheduled time" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {record.shiftTime}
                  </td>
                  <td role="cell" data-label="Scheduled hours" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {record.shiftHrs ?? "—"}
                  </td>
                  <td role="cell" data-label="Clock in" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {formatTime(record.clockIn)}
                  </td>
                  <td role="cell" data-label="Clock out" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {formatTime(record.clockOut)}
                  </td>
                  <td role="cell" data-label="Break" className="px-4 py-3 text-sm whitespace-nowrap">
                    {record.onBreak
                      ? <span className="text-[hsl(var(--color-warning))] font-medium">On break</span>
                      : (record.breakMins > 0 ? `${record.breakMins}m` : "—")}
                  </td>
                  <td role="cell" data-label="Total hours" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
                    {record.status === 'CLOCKED_IN'
                      ? <LiveElapsed clockInTimestamp={record.clockInTimestamp} breakMins={record.breakMins} />
                      : (record.totalHrs ?? "—")}
                  </td>
                  <td role="cell" data-label="Status" data-field="status" className="px-4 py-3 whitespace-nowrap">
                    <div className="flex flex-col gap-1">
                      <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusBadge(record.status)}`}>
                        {formatStatus(record.status)}
                      </span>
                      {record.isLate && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[hsl(var(--color-warning-soft))] text-[hsl(var(--color-warning))]">Late</span>}
                      {record.isEarlyLeave && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-[hsl(var(--color-warning-soft))] text-[hsl(var(--color-warning))]">Early Leave</span>}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </ResponsiveTable>
      </div>

      {/* Footer */}
      <div className="data-pagination">
        <div className="text-sm text-[hsl(var(--color-foreground-secondary))] italic">
          {totalShifts === 0
            ? "Showing 0 to 0 of 0 entries"
            : `Showing ${startIdx + 1} to ${Math.min(startIdx + itemsPerPage, totalShifts)} of ${totalShifts} entries`}
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
            Previous
          </Button>
          <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      </div>
    </div>
  );

  // ── Chart View ─────────────────────────────────────────────────────────────
  const renderChartView = () => (
    <div className="flex flex-col xl:flex-row gap-6">
      {/* Bar Chart */}
      <div className="flex-1 bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-[hsl(var(--color-foreground))]">Today's Attendance</span>
          <button
            onClick={fetchAttendance}
            className="p-1.5 hover:bg-[hsl(var(--color-surface-elevated))] rounded transition-colors"
          >
            <RotateCw className={`w-4 h-4 text-[hsl(var(--color-foreground-secondary))] ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>

        {loading ? (
          <div className="h-64 flex items-center justify-center text-sm text-[hsl(var(--color-foreground-secondary))]">
            <RotateCw className="w-4 h-4 animate-spin mr-2" /> Loading…
          </div>
        ) : (
          <>
            {/* Bar Chart */}
            <div className="h-48 flex items-end justify-around gap-2 mb-4">
              {attendanceData.map((item) => (
                <div key={item.label} className="flex flex-col items-center flex-1">
                  <div className="w-full bg-[hsl(var(--color-surface-elevated))] rounded-t relative" style={{ height: "160px" }}>
                    <div
                      className={`${item.color} rounded-t absolute bottom-0 w-full transition-all duration-500`}
                      style={{ height: `${(item.value / maxVal) * 100}%` }}
                    />
                  </div>
                  <div className="text-xs text-[hsl(var(--color-foreground-secondary))] mt-2 text-center w-full px-1 truncate" title={item.label}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>

            {/* Circles */}
            <div className="grid grid-cols-4 md:grid-cols-8 gap-4 mt-4">
              {attendanceData.map((item) => (
                <div key={item.label} className="flex flex-col items-center">
                  <div className="w-14 h-14 rounded-full border-4 border-[hsl(var(--color-border))] flex items-center justify-center">
                    <span className="text-base font-bold text-[hsl(var(--color-foreground))]">{item.value}</span>
                  </div>
                  <div className="text-xs text-[hsl(var(--color-foreground-secondary))] mt-1.5 text-center px-1 truncate" title={item.label}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {/* Stats Sidebar */}
      <div className="xl:w-72 bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-3xl p-6 shadow-sm">
        <div className="flex items-center justify-between mb-4">
          <span className="text-sm font-semibold text-[hsl(var(--color-foreground))]">Summary</span>
          <Select
            value={chartType}
            onChange={(e) => setChartType(e.target.value)}
            className="w-28 text-sm"
          >
            <option value="bar">Bar Chart</option>
            <option value="pie">Pie Chart</option>
            <option value="line">Line Chart</option>
          </Select>
        </div>

        <div className="space-y-1">
          {summaryStats.map((stat, index) => (
            <div
              key={stat.label}
              className={`flex items-center justify-between py-2 px-3 rounded ${
                index >= summaryStats.length - 2
                  ? "bg-[hsl(var(--color-surface-elevated))] font-semibold"
                  : "hover:bg-[hsl(var(--color-surface-elevated))]"
              }`}
            >
              <span className="text-sm text-[hsl(var(--color-foreground-secondary))]">{stat.label}</span>
              <span className="text-sm font-medium text-[hsl(var(--color-foreground))]">{stat.value}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <div>
      {/* Toggle */}
      <div className="flex items-center justify-end gap-2 mb-4">
        <button
          onClick={() => setViewMode("shift")}
          className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            viewMode === "shift"
              ? "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] shadow-md hover:bg-[hsl(var(--color-primary))]"
              : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground-secondary))] border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-surface-elevated))] shadow-sm"
          }`}
        >
          Attendance By Shift
        </button>
        <button
          onClick={() => setViewMode("live")}
          className={`px-5 py-2.5 text-sm font-semibold rounded-xl transition-all ${
            viewMode === "live"
              ? "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] shadow-md hover:bg-[hsl(var(--color-primary))]"
              : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground-secondary))] border border-[hsl(var(--color-border))] hover:bg-[hsl(var(--color-surface-elevated))] shadow-sm"
          }`}
        >
          Live Attendance
        </button>
      </div>

      {viewMode === "live" ? renderLiveAttendance() : renderChartView()}
    </div>
  );
}
