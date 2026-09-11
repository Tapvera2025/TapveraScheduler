import { useState } from "react";
import { CalendarDays, Clock, MapPin, Plus, Search, User } from "lucide-react";
import { formatTime, formatDate } from "../../lib/format";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";

const localDay = (date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;

function getStatusBadge(shift) {
  if (shift.isAdhoc) return { label: "Adhoc", cls: "badge-warning" };

  if (shift.status === "COMPLETED") {
    let label = "Completed";
    if (shift.actualStartTime && shift.actualEndTime) {
      const mins = Math.round(
        (new Date(shift.actualEndTime) - new Date(shift.actualStartTime)) / 60000
      );
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      label = `Completed · ${m > 0 ? `${h}h ${m}m` : `${h}h`}`;
    }
    return { label, cls: "badge-success" };
  }

  if (shift.status === "IN_PROGRESS") {
    const isLate =
      shift.actualStartTime &&
      new Date(shift.actualStartTime) - new Date(shift.startTime) > 5 * 60 * 1000;
    return isLate
      ? { label: "Late", cls: "badge-warning" }
      : { label: "Working", cls: "badge-info" };
  }

  if (shift.status === "NO_SHOW") return { label: "No Show", cls: "badge-error" };
  if (shift.status === "CANCELLED") return { label: "Cancelled", cls: "badge-neutral" };

  return { label: "Confirmed", cls: "badge-neutral" };
}

/** The same date range and shift data as the desktop calendar, read vertically. */
export default function ShiftAgenda({ dates, shifts, employees = [], loading, onAdd, showEmployee = false, needsSite = false }) {
  const [search, setSearch] = useState("");
  const [showEmpty, setShowEmpty] = useState(false);
  const today = localDay(new Date());
  const employeeFor = (shift) => {
    if (typeof shift.employeeId === "object" && shift.employeeId) return shift.employeeId;
    return employees.find(employee => (employee.id || employee._id) === shift.employeeId);
  };
  const siteName = (shift) => (shift.siteId || shift.site)?.siteLocationName || (shift.siteId || shift.site)?.shortName || "Site to be confirmed";
  const employeeName = (shift) => {
    const employee = employeeFor(shift);
    return employee ? employee.name || `${employee.firstName || ""} ${employee.lastName || ""}`.trim() : "Open shift";
  };
  const filtered = shifts.filter(shift => `${siteName(shift)} ${employeeName(shift)} ${employeeFor(shift)?.position || ""}`.toLowerCase().includes(search.toLowerCase()));
  const groups = dates.map((date, index) => ({ date, index, day: localDay(date), shifts: filtered.filter(shift => String(shift.date).slice(0, 10) === localDay(date)).sort((a,b) => new Date(a.startTime) - new Date(b.startTime)) }));

  if (needsSite) return <div className="agenda-mobile agenda-empty"><MapPin size={28} /><h2>Choose a site to get started</h2><p>Your team’s shifts will appear here, day by day.</p></div>;
  return <section className="agenda-mobile shift-agenda" aria-label="Shift agenda">
    <div className="agenda-heading"><div><p className="eyebrow">YOUR SCHEDULE</p><h2>Day by day</h2></div><span>{filtered.length} shifts</span></div>
    <div className="directory-search"><Search size={16} /><Input aria-label="Search shifts" value={search} onChange={event => setSearch(event.target.value)} placeholder={showEmployee ? "Find a person, site or position…" : "Find a site…"} /></div>
    <label className="agenda-empty-toggle"><input type="checkbox" checked={showEmpty} onChange={event => setShowEmpty(event.target.checked)} />Show days without shifts</label>
    {loading ? <p className="agenda-empty" role="status">Loading shifts…</p> : <>
      {!filtered.length && !showEmpty && <div className="agenda-empty"><CalendarDays size={28} /><h3>{search ? "No matching shifts" : "No shifts this period"}</h3><p>{search ? "Try another name or clear your search." : "Use the date controls to explore another week."}</p>{onAdd && <Button onClick={() => onAdd(null, 0)}><Plus size={16} />Add a shift</Button>}</div>}
      {groups.filter(group => showEmpty || group.shifts.length).map(group => <section className="agenda-day" key={group.day}>
        <header><div className={`agenda-date ${group.day === today ? "is-today" : ""}`}><span>{group.date.toLocaleDateString("en", { weekday: "short" })}</span><strong>{group.date.getDate()}</strong></div><div><h3>{group.day === today ? "Today" : group.date.toLocaleDateString("en", { weekday: "long" })}</h3><p>{formatDate(group.date)} · {group.shifts.length} {group.shifts.length === 1 ? "shift" : "shifts"}</p></div>{onAdd && <button className="icon-button" onClick={() => onAdd(null, group.index)} aria-label={`Add shift on ${formatDate(group.date)}`}><Plus size={19} /></button>}</header>
        {group.shifts.length ? group.shifts.map(shift => {
          const hours = (new Date(shift.endTime) - new Date(shift.startTime)) / 3600000;
          return <article className={`agenda-shift ${shift.isAdhoc ? "is-adhoc" : ""}`} key={shift.id || shift._id}>
            <div className="agenda-shift-time"><Clock size={16} /><strong>{formatTime(shift.startTime)} – {formatTime(shift.endTime)}</strong>{Number.isFinite(hours) && <span>{Number(hours.toFixed(1))} hrs</span>}</div>
            {showEmployee && <div className="agenda-shift-person"><User size={15} /><span>{employeeName(shift)}</span></div>}
            <div className="agenda-shift-site"><MapPin size={15} /><span>{siteName(shift)}</span></div>
            <div className="agenda-shift-footer">{(() => { const { label, cls } = getStatusBadge(shift); return <span className={`attendance-status ${cls}`}>{label}</span>; })()}{shift.position && <span>{shift.position}</span>}</div>
          </article>;
        }) : <p className="agenda-day-off">No shifts scheduled</p>}
      </section>)}
    </>}
  </section>;
}
