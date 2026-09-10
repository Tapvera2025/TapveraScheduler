import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "../ui/Table";

/**
 * Typed renderers for what the gateway returned.
 *
 * There is one renderer per tool and nothing free-form: the agent's answer is
 * drawn from named fields of a known result, so a model cannot put arbitrary
 * text on screen dressed up as data.
 */

const TONE = {
  attended: "success",
  in_progress: "info",
  missing_clock_out: "warning",
  on_leave: "info",
  not_yet_due: "muted",
  no_show: "error",
  cancelled: "muted",
};

const LABEL = {
  attended: "Attended",
  in_progress: "On shift",
  missing_clock_out: "No clock-out",
  on_leave: "Leave",
  not_yet_due: "Not yet due",
  no_show: "No show",
  cancelled: "Cancelled",
};

function Chip({ tone = "muted", children }) {
  const tones = {
    success: "bg-[hsl(var(--color-success-soft))] text-[hsl(var(--color-success))]",
    warning: "bg-[hsl(var(--color-warning-soft))] text-[hsl(var(--color-warning))]",
    error: "bg-[hsl(var(--color-error-soft))] text-[hsl(var(--color-error))]",
    info: "bg-[hsl(var(--color-info-soft))] text-[hsl(var(--color-info))]",
    muted: "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-muted))]",
  };
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${tones[tone] || tones.muted}`}>
      {children}
    </span>
  );
}

function Tile({ label, value, tone }) {
  const colour =
    tone === "error"
      ? "text-[hsl(var(--color-error))]"
      : tone === "warning"
        ? "text-[hsl(var(--color-warning))]"
        : "text-[hsl(var(--color-foreground))]";
  return (
    <div className="agent-tile">
      <div className={`text-lg font-bold ${colour}`}>{value}</div>
      <div className="text-[10px] text-[hsl(var(--color-foreground-muted))] mt-0.5">{label}</div>
    </div>
  );
}

function AttendanceReport({ data }) {
  return (
    <div className="agent-result">
      <p className="eyebrow">
        {data.employee?.name} &middot; {data.label}
      </p>

      <div className="agent-tiles">
        <Tile label="Rostered" value={data.scheduledShifts} />
        <Tile label="Attended" value={data.attendedShifts} />
        <Tile label="No shows" value={data.confirmedNoShows} tone={data.confirmedNoShows ? "error" : undefined} />
        <Tile label="Late" value={data.lateArrivals} tone={data.lateArrivals ? "warning" : undefined} />
        <Tile label="Hours clocked" value={data.elapsedHours} />
      </div>

      <p className="agent-note">
        Payable hours are not shown: {data.paidHoursNote}
      </p>

      {data.exceptions?.length > 0 && (
        <div className="agent-exceptions">
          <p className="eyebrow">NEEDS ATTENTION</p>
          {data.exceptions.slice(0, 6).map((ex, i) => (
            <div key={i} className="agent-exception">
              <Chip tone="warning">{ex.day}</Chip>
              <span>{ex.detail}</span>
            </div>
          ))}
        </div>
      )}

      {data.rows?.length > 0 && (
        <div className="agent-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Day</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Rostered</TableHead>
                <TableHead>Clocked</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.shiftId}>
                  <TableCell data-label="Day" data-field="title">{row.day}</TableCell>
                  <TableCell data-label="Site" data-field="wide">{row.site || "—"}</TableCell>
                  <TableCell data-label="Rostered" className="whitespace-nowrap">
                    {row.scheduledStart} → {row.scheduledEnd}
                  </TableCell>
                  <TableCell data-label="Clocked" className="whitespace-nowrap">
                    {row.clockIn ? `${row.clockIn}${row.clockOut ? ` → ${row.clockOut}` : " → —"}` : "—"}
                  </TableCell>
                  <TableCell data-label="Status" data-field="status">
                    <Chip tone={TONE[row.classification]}>{LABEL[row.classification] || row.classification}</Chip>
                    {row.late && <span className="ml-1"><Chip tone="warning">Late</Chip></span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      <p className="agent-provenance">
        As at {new Date(data.asOf).toLocaleString()} &middot; {data.timezone} &middot; rules {data.sourceVersion}
      </p>
    </div>
  );
}

function EmployeeShifts({ data }) {
  return (
    <div className="agent-result">
      <p className="eyebrow">
        {data.employee?.name} &middot; {data.window?.label}
      </p>

      {data.rows?.length === 0 && <p className="agent-empty">No shifts rostered in this period.</p>}

      {data.rows?.length > 0 && (
        <div className="agent-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Site</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Hours</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell data-label="Site" data-field="title">{row.site || "—"}</TableCell>
                  <TableCell data-label="Start" className="whitespace-nowrap">{row.start}</TableCell>
                  <TableCell data-label="End" className="whitespace-nowrap">{row.end}</TableCell>
                  <TableCell data-label="Hours">{row.scheduledHours ?? "—"}</TableCell>
                  <TableCell data-label="Status" data-field="status">
                    <Chip tone={row.status === "CANCELLED" ? "muted" : "info"}>{row.status}</Chip>
                    {row.isAdhoc && <span className="ml-1"><Chip tone="warning">Adhoc</Chip></span>}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {data.truncated && <p className="agent-note">Showing the first {data.count} shifts only.</p>}
    </div>
  );
}

function ShiftCreated({ data, replayed }) {
  return (
    <div className="agent-result">
      <div className="agent-success">
        <strong>Shift created</strong>
        {replayed && <Chip tone="muted">already done</Chip>}
      </div>
      <dl className="agent-facts">
        <div><dt>Employee</dt><dd>{data.employee?.name}</dd></div>
        <div><dt>Site</dt><dd>{data.site?.name}</dd></div>
        <div><dt>Start</dt><dd>{data.start}</dd></div>
        <div><dt>End</dt><dd>{data.end}</dd></div>
        <div><dt>Hours</dt><dd>{data.hours}</dd></div>
      </dl>
      <p className="agent-provenance">Reference {data.shiftId}</p>
    </div>
  );
}

function EmployeeAdded({ data, replayed }) {
  return (
    <div className="agent-result">
      <div className="agent-success">
        <strong>Employee added</strong>
        {replayed && <Chip tone="muted">already done</Chip>}
      </div>
      <dl className="agent-facts">
        <div><dt>Name</dt><dd>{data.employee?.name}</dd></div>
        <div><dt>Email</dt><dd>{data.email}</dd></div>
        <div><dt>Position</dt><dd>{data.position}</dd></div>
        {data.department && <div><dt>Department</dt><dd>{data.department}</dd></div>}
      </dl>
      <p className="agent-note">
        No login was created, and they will not appear on a roster until assigned to a site.
      </p>
      <p className="agent-provenance">Reference {data.employeeId}</p>
    </div>
  );
}

function RecordAdded({ title, rows, note, reference, replayed }) {
  return (
    <div className="agent-result">
      <div className="agent-success">
        <strong>{title}</strong>
        {replayed && <Chip tone="muted">already done</Chip>}
      </div>
      <dl className="agent-facts">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      {note && <p className="agent-note">{note}</p>}
      {reference && <p className="agent-provenance">Reference {reference}</p>}
    </div>
  );
}

function EmployeeList({ data }) {
  return (
    <div className="agent-result">
      <p className="eyebrow">
        {data.site ? `Employees at ${data.site}` : "All employees"} &middot; {data.count}
      </p>
      {data.rows?.length === 0 && <p className="agent-empty">No employees found.</p>}
      {data.rows?.length > 0 && (
        <div className="agent-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Position</TableHead>
                <TableHead>Department</TableHead>
                <TableHead>Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.id}>
                  <TableCell data-label="Name" data-field="title">{row.name}</TableCell>
                  <TableCell data-label="Position">{row.position || "—"}</TableCell>
                  <TableCell data-label="Department">{row.department || "—"}</TableCell>
                  <TableCell data-label="Phone">{row.phone || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.truncated && <p className="agent-note">Showing first {data.count} employees only.</p>}
    </div>
  );
}

function DailySummary({ data }) {
  return (
    <div className="agent-result">
      <p className="eyebrow">
        {data.isToday ? "Today" : data.date}
        {data.site ? ` · ${data.site}` : ""}
        {" · "}
        {data.totalShifts} shift{data.totalShifts !== 1 ? "s" : ""}
        {data.openShifts > 0 && ` (${data.openShifts} open)`}
      </p>
      {data.rows?.length === 0 && (
        <p className="agent-empty">No shifts rostered for this date.</p>
      )}
      {data.rows?.length > 0 && (
        <div className="agent-table">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employee</TableHead>
                <TableHead>Site</TableHead>
                <TableHead>Start</TableHead>
                <TableHead>End</TableHead>
                <TableHead>Hrs</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.map((row) => (
                <TableRow key={row.shiftId}>
                  <TableCell data-label="Employee" data-field="title">
                    {row.employee ? (
                      <>
                        <span>{row.employee.name}</span>
                        {row.employee.position && (
                          <span className="block text-[10px] text-[hsl(var(--color-foreground-muted))]">
                            {row.employee.position}
                          </span>
                        )}
                      </>
                    ) : (
                      <Chip tone="warning">Open</Chip>
                    )}
                  </TableCell>
                  <TableCell data-label="Site">{row.site || "—"}</TableCell>
                  <TableCell data-label="Start" className="whitespace-nowrap">{row.start}</TableCell>
                  <TableCell data-label="End" className="whitespace-nowrap">{row.end}</TableCell>
                  <TableCell data-label="Hrs">{row.scheduledHours ?? "—"}</TableCell>
                  <TableCell data-label="Status" data-field="status">
                    <Chip tone={row.isAdhoc ? "warning" : "info"}>
                      {row.isAdhoc ? "Adhoc" : row.shiftType}
                    </Chip>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {data.truncated && <p className="agent-note">Showing first {data.totalShifts} shifts only.</p>}
    </div>
  );
}

function ShiftCancelled({ data, replayed }) {
  return (
    <div className="agent-result">
      <div className="agent-success" style={{ color: "hsl(var(--color-warning))" }}>
        <strong>Shift cancelled</strong>
        {replayed && <Chip tone="muted">already done</Chip>}
        {data.alreadyCancelled && <Chip tone="muted">was already cancelled</Chip>}
      </div>
      <dl className="agent-facts">
        {data.employee && <div><dt>Employee</dt><dd>{data.employee}</dd></div>}
        {data.site && <div><dt>Site</dt><dd>{data.site}</dd></div>}
        {data.start && <div><dt>Start</dt><dd>{data.start}</dd></div>}
        {data.end && <div><dt>End</dt><dd>{data.end}</dd></div>}
      </dl>
      <p className="agent-provenance">Reference {data.shiftId}</p>
    </div>
  );
}

export default function AgentResult({ envelope }) {
  if (!envelope?.data) return null;
  const { tool, data, replayed } = envelope;

  if (tool === "getAttendanceReport") return <AttendanceReport data={data} />;
  if (tool === "findEmployeeShifts") return <EmployeeShifts data={data} />;
  if (tool === "getDailySummary") return <DailySummary data={data} />;
  if (tool === "listEmployees") return <EmployeeList data={data} />;
  if (tool === "createShift") return <ShiftCreated data={data} replayed={replayed} />;
  if (tool === "cancelShift") return <ShiftCancelled data={data} replayed={replayed} />;
  if (tool === "createEmployee") return <EmployeeAdded data={data} replayed={replayed} />;
  if (tool === "createClient")
    return (
      <RecordAdded
        title="Client added"
        rows={[["Client", data.client?.name], ["State", data.state]]}
        note="Sites can now be added under this client."
        reference={data.clientId}
        replayed={replayed}
      />
    );
  if (tool === "createSite")
    return (
      <RecordAdded
        title="Site added"
        rows={[
          ["Site", data.site?.name],
          ["Short code", data.shortName],
          ["Client", data.client],
          ["Timezone", data.timezone],
        ]}
        note="Assign employees to this site before rostering anyone there."
        reference={data.siteId}
        replayed={replayed}
      />
    );

  return <p className="agent-note">This result has no display yet.</p>;
}
