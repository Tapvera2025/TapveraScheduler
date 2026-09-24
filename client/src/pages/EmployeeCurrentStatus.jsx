import { useState, useEffect, useCallback, useRef } from "react";
import { MapPin, Clock, Coffee, LogIn, LogOut, Users, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { clockApi, siteApi } from "../lib/api";
import { useSocketEvent, useSocket } from "../contexts/SocketContext";

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatTime(date) {
  if (!date) return "--:--";
  return new Date(date).toLocaleTimeString("en-AU", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  });
}

function initials(employee) {
  if (!employee) return "?";
  return `${(employee.firstName || "")[0] || ""}${(employee.lastName || "")[0] || ""}`.toUpperCase();
}

/** Total completed + ongoing break milliseconds. When clockedOut is true the
 *  last open break (if any) is capped at the clock-out time. */
function calcBreakMs(breaks = [], clockOutTime = null) {
  const cap = clockOutTime ? new Date(clockOutTime).getTime() : Date.now();
  return breaks.reduce((acc, b) => {
    const end = b.endTime ? new Date(b.endTime).getTime() : cap;
    return acc + Math.max(0, end - new Date(b.startTime).getTime());
  }, 0);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function formatDuration(ms) {
  const totalSecs = Math.floor(Math.max(0, ms) / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h ${pad(m)}m ${pad(s)}s`;
  return `${pad(m)}m ${pad(s)}s`;
}

/** ms → "Xh Ym" (no seconds, for the static completed-break display) */
function formatBreakDuration(ms) {
  const totalMins = Math.floor(Math.max(0, ms) / 60000);
  const h = Math.floor(totalMins / 60);
  const m = totalMins % 60;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function isOnBreak(record) {
  if (record.status === "CLOCKED_OUT") return false;
  if (!record.breaks || record.breaks.length === 0) return false;
  return !record.breaks[record.breaks.length - 1].endTime;
}

function isClockedOut(record) {
  return record.status === "CLOCKED_OUT";
}

// ── Sub-components ───────────────────────────────────────────────────────────

/** Ticking worked-time display — only rendered for active (CLOCKED_IN) records */
function LiveTimer({ clockInTime, breaks }) {
  const [, forceRender] = useState(0);

  useEffect(() => {
    const id = setInterval(() => forceRender((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const totalMs = Date.now() - new Date(clockInTime).getTime();
  const breakMs = calcBreakMs(breaks);
  const workMs = Math.max(0, totalMs - breakMs);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[hsl(var(--color-foreground))]">
        <Clock className="w-3.5 h-3.5 text-[hsl(var(--color-primary))]" />
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatDuration(workMs)}
        </span>
        <span className="text-[10px] text-[hsl(var(--color-foreground-muted))]">worked</span>
      </div>
      {breakMs > 0 && (
        <div className="flex items-center gap-1.5 text-[hsl(var(--color-foreground-muted))]">
          <Coffee className="w-3 h-3" />
          <span className="font-mono text-xs tabular-nums">{formatBreakDuration(breakMs)}</span>
          <span className="text-[10px]">break</span>
        </div>
      )}
    </div>
  );
}

/** Static final summary for CLOCKED_OUT records */
function FinalSummary({ record }) {
  const grossMs = record.clockOutTime && record.clockInTime
    ? new Date(record.clockOutTime).getTime() - new Date(record.clockInTime).getTime()
    : 0;
  const breakMs = calcBreakMs(record.breaks || [], record.clockOutTime);
  const workMs = Math.max(0, grossMs - breakMs);

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center gap-1.5 text-[hsl(var(--color-foreground-muted))]">
        <Clock className="w-3.5 h-3.5" />
        <span className="font-mono text-sm font-semibold tabular-nums">
          {formatBreakDuration(workMs)}
        </span>
        <span className="text-[10px]">total worked</span>
      </div>
      {breakMs > 0 && (
        <div className="flex items-center gap-1.5 text-[hsl(var(--color-foreground-muted))]">
          <Coffee className="w-3 h-3" />
          <span className="font-mono text-xs tabular-nums">{formatBreakDuration(breakMs)}</span>
          <span className="text-[10px]">break</span>
        </div>
      )}
    </div>
  );
}

function StatusBadge({ record }) {
  if (isClockedOut(record)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-muted))] border border-[hsl(var(--color-border))]">
        <LogOut className="w-3 h-3" />
        Clocked Out
      </span>
    );
  }
  if (isOnBreak(record)) {
    return (
      <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400">
        <Coffee className="w-3 h-3" />
        On Break
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
      Clocked In
    </span>
  );
}

function EmployeeCard({ record }) {
  const emp = record.employeeId;
  const onBreakNow = isOnBreak(record);
  const clockedOut = isClockedOut(record);

  let borderClass = "border-[hsl(var(--color-border))]";
  if (onBreakNow) borderClass = "border-amber-300 dark:border-amber-700";
  if (clockedOut) borderClass = "border-[hsl(var(--color-border))] opacity-70";

  let avatarClass = "bg-gradient-to-br from-[hsl(var(--color-primary))] to-[hsl(var(--color-primary))]";
  if (onBreakNow) avatarClass = "bg-gradient-to-br from-amber-400 to-amber-600";
  if (clockedOut) avatarClass = "bg-[hsl(var(--color-foreground-muted))]";

  return (
    <div className={`bg-[hsl(var(--color-card))] border rounded-xl p-4 flex flex-col gap-3 transition-shadow hover:shadow-md ${borderClass}`}>
      {/* Top row: avatar + name + status */}
      <div className="flex items-start gap-3">
        <div className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold text-white flex-shrink-0 ${avatarClass}`}>
          {initials(emp)}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-[hsl(var(--color-foreground))] truncate">
            {emp ? `${emp.firstName} ${emp.lastName}` : "Unknown"}
          </p>
          {emp?.position && (
            <p className="text-[11px] text-[hsl(var(--color-foreground-muted))] truncate">
              {emp.position}
            </p>
          )}
          <div className="mt-1">
            <StatusBadge record={record} />
          </div>
        </div>
      </div>

      {/* Clock in / out times + breaks */}
      <div className="grid grid-cols-2 gap-2 text-xs">
        <div className="flex flex-col gap-0.5">
          <span className="text-[10px] font-medium text-[hsl(var(--color-foreground-muted))] uppercase tracking-wide">
            Clocked In
          </span>
          <div className="flex items-center gap-1 text-[hsl(var(--color-foreground))]">
            <LogIn className="w-3 h-3 text-emerald-500" />
            <span className="font-medium">{formatTime(record.clockInTime)}</span>
          </div>
        </div>

        {clockedOut ? (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-[hsl(var(--color-foreground-muted))] uppercase tracking-wide">
              Clocked Out
            </span>
            <div className="flex items-center gap-1 text-[hsl(var(--color-foreground))]">
              <LogOut className="w-3 h-3 text-[hsl(var(--color-foreground-muted))]" />
              <span className="font-medium">{formatTime(record.clockOutTime)}</span>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            <span className="text-[10px] font-medium text-[hsl(var(--color-foreground-muted))] uppercase tracking-wide">
              Breaks
            </span>
            <div className="flex items-center gap-1 text-[hsl(var(--color-foreground))]">
              <Coffee className="w-3 h-3 text-amber-500" />
              <span className="font-medium">
                {record.breaks?.length
                  ? `${record.breaks.length} break${record.breaks.length > 1 ? "s" : ""}`
                  : "None"}
              </span>
            </div>
          </div>
        )}
      </div>

      {/* Break summary row for clocked-out records that had breaks */}
      {clockedOut && record.breaks?.length > 0 && (
        <div className="flex items-center gap-1 text-xs text-[hsl(var(--color-foreground-muted))]">
          <Coffee className="w-3 h-3 text-amber-500" />
          <span>
            {record.breaks.length} break{record.breaks.length > 1 ? "s" : ""} · {formatBreakDuration(calcBreakMs(record.breaks, record.clockOutTime))}
          </span>
        </div>
      )}

      {/* Timer / final summary */}
      <div className="pt-2 border-t border-[hsl(var(--color-border))]">
        {clockedOut
          ? <FinalSummary record={record} />
          : <LiveTimer clockInTime={record.clockInTime} breaks={record.breaks || []} />
        }
      </div>
    </div>
  );
}

function SiteSection({ site, records }) {
  const activeCount = records.filter((r) => !isClockedOut(r) && !isOnBreak(r)).length;
  const onBreakCount = records.filter(isOnBreak).length;
  const clockedOutCount = records.filter(isClockedOut).length;

  return (
    <div className="mb-8">
      <div className="flex items-center gap-3 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-lg bg-[hsl(var(--color-primary-soft))] flex items-center justify-center">
            <MapPin className="w-4 h-4 text-[hsl(var(--color-primary))]" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-[hsl(var(--color-foreground))]">
              {site.siteLocationName || site.shortName}
            </h3>
            {site.shortName && site.siteLocationName && (
              <p className="text-[11px] text-[hsl(var(--color-foreground-muted))]">{site.shortName}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 ml-auto flex-wrap justify-end">
          {activeCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 font-medium">
              <Users className="w-3.5 h-3.5" />
              {activeCount} working
            </span>
          )}
          {onBreakCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400 font-medium">
              <Coffee className="w-3.5 h-3.5" />
              {onBreakCount} on break
            </span>
          )}
          {clockedOutCount > 0 && (
            <span className="flex items-center gap-1 text-xs text-[hsl(var(--color-foreground-muted))] font-medium">
              <LogOut className="w-3.5 h-3.5" />
              {clockedOutCount} done
            </span>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {/* Active first, clocked-out last */}
        {[...records]
          .sort((a, b) => {
            if (isClockedOut(a) !== isClockedOut(b)) return isClockedOut(a) ? 1 : -1;
            return new Date(a.clockInTime) - new Date(b.clockInTime);
          })
          .map((r) => (
            <EmployeeCard key={r._id} record={r} />
          ))}
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function EmployeeCurrentStatus() {
  const [records, setRecords] = useState([]);
  const [sites, setSites] = useState([]);
  const [selectedSiteId, setSelectedSiteId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState(null);
  const { connected } = useSocket();

  const selectedSiteIdRef = useRef(selectedSiteId);
  selectedSiteIdRef.current = selectedSiteId;

  const fetchRecords = useCallback(async (siteId) => {
    try {
      const res = await clockApi.getLiveStatus(siteId);
      setRecords(res.data.data || []);
      setLastUpdated(new Date());
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    siteApi.getAll({ limit: 200 }).then((res) => {
      setSites(res.data.data?.sites || res.data.sites || []);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    setLoading(true);
    fetchRecords(selectedSiteId);
  }, [selectedSiteId, fetchRecords]);

  const handleAttendanceUpdate = useCallback(({ type, record }) => {
    const activeSite = selectedSiteIdRef.current;
    const recordSiteId =
      typeof record.siteId === "object"
        ? record.siteId?._id || record.siteId?.id
        : record.siteId;

    if (activeSite && recordSiteId && String(recordSiteId) !== String(activeSite)) return;

    setLastUpdated(new Date());

    // Always upsert — clocked-out records stay on screen with their final data
    setRecords((prev) => {
      const idx = prev.findIndex((r) => r._id === record._id);
      if (idx === -1) return [...prev, record];
      const next = [...prev];
      next[idx] = record;
      return next;
    });
  }, []);

  useSocketEvent("attendance-update", handleAttendanceUpdate);

  // Group by site
  const grouped = records.reduce((acc, r) => {
    const site = r.siteId;
    const key = typeof site === "object" ? (site?._id || site?.id || "unknown") : (site || "unknown");
    if (!acc[key]) {
      acc[key] = {
        site: typeof site === "object" ? site : { siteLocationName: "Unknown Site", shortName: "" },
        records: [],
      };
    }
    acc[key].records.push(r);
    return acc;
  }, {});

  const activeCount = records.filter((r) => !isClockedOut(r) && !isOnBreak(r)).length;
  const breakCount = records.filter(isOnBreak).length;
  const doneCount = records.filter(isClockedOut).length;

  return (
    <div className="p-4 sm:p-6 max-w-screen-2xl mx-auto">
      {/* Header */}
      <div className="flex items-start justify-between mb-6 gap-4 flex-wrap">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="text-xl font-bold text-[hsl(var(--color-foreground))]">Current Status</h1>
            <span className="flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              Live
            </span>
          </div>
          <p className="text-sm text-[hsl(var(--color-foreground-muted))]">
            Today's attendance across all sites
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div className={`flex items-center gap-1.5 text-xs font-medium ${connected ? "text-emerald-600 dark:text-emerald-400" : "text-[hsl(var(--color-foreground-muted))]"}`}>
            {connected ? <Wifi className="w-4 h-4" /> : <WifiOff className="w-4 h-4" />}
            {connected ? "Live" : "Offline"}
          </div>
          <button
            onClick={() => fetchRecords(selectedSiteId)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[hsl(var(--color-border))] text-xs font-medium text-[hsl(var(--color-foreground-muted))] hover:text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Refresh
          </button>
        </div>
      </div>

      {/* Summary bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[hsl(var(--color-primary-soft))] flex items-center justify-center">
            <Users className="w-5 h-5 text-[hsl(var(--color-primary))]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[hsl(var(--color-foreground))]">{records.length}</p>
            <p className="text-xs text-[hsl(var(--color-foreground-muted))]">Total today</p>
          </div>
        </div>
        <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-emerald-100 dark:bg-emerald-900/30 flex items-center justify-center">
            <LogIn className="w-5 h-5 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[hsl(var(--color-foreground))]">{activeCount}</p>
            <p className="text-xs text-[hsl(var(--color-foreground-muted))]">Working</p>
          </div>
        </div>
        <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <Coffee className="w-5 h-5 text-amber-600 dark:text-amber-400" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[hsl(var(--color-foreground))]">{breakCount}</p>
            <p className="text-xs text-[hsl(var(--color-foreground-muted))]">On break</p>
          </div>
        </div>
        <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-xl p-4 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-[hsl(var(--color-surface-elevated))] flex items-center justify-center">
            <LogOut className="w-5 h-5 text-[hsl(var(--color-foreground-muted))]" />
          </div>
          <div>
            <p className="text-2xl font-bold text-[hsl(var(--color-foreground))]">{doneCount}</p>
            <p className="text-xs text-[hsl(var(--color-foreground-muted))]">Clocked out</p>
          </div>
        </div>
      </div>

      {/* Site filter pills */}
      <div className="flex items-center gap-2 flex-wrap mb-4">
        <button
          onClick={() => setSelectedSiteId(null)}
          className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
            selectedSiteId === null
              ? "bg-[hsl(var(--color-primary))] text-white border-[hsl(var(--color-primary))]"
              : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground-muted))] border-[hsl(var(--color-border))] hover:text-[hsl(var(--color-foreground))]"
          }`}
        >
          All Sites
        </button>
        {sites.map((s) => (
          <button
            key={s._id || s.id}
            onClick={() => setSelectedSiteId(s._id || s.id)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium transition-colors border ${
              selectedSiteId === (s._id || s.id)
                ? "bg-[hsl(var(--color-primary))] text-white border-[hsl(var(--color-primary))]"
                : "bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground-muted))] border-[hsl(var(--color-border))] hover:text-[hsl(var(--color-foreground))]"
            }`}
          >
            {s.shortName || s.siteLocationName}
          </button>
        ))}
      </div>

      {lastUpdated && (
        <p className="text-[11px] text-[hsl(var(--color-foreground-muted))] mb-4">
          Updated {lastUpdated.toLocaleTimeString("en-AU", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: true })}
        </p>
      )}

      {/* Content */}
      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-xl p-4 h-44 animate-pulse" />
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-center">
          <div className="w-16 h-16 rounded-full bg-[hsl(var(--color-surface-elevated))] flex items-center justify-center mb-4">
            <LogOut className="w-7 h-7 text-[hsl(var(--color-foreground-muted))]" />
          </div>
          <p className="text-sm font-medium text-[hsl(var(--color-foreground))]">No activity today</p>
          <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1">
            {selectedSiteId
              ? "No employees have clocked in at this site today"
              : "No employees have clocked in today"}
          </p>
        </div>
      ) : (
        Object.values(grouped).map(({ site, records: siteRecords }) => (
          <SiteSection key={site._id || site.id || "unknown"} site={site} records={siteRecords} />
        ))
      )}
    </div>
  );
}
