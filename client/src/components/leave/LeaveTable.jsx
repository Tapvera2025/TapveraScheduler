import ResponsiveTable from "../ui/ResponsiveTable";
import { Fragment, useState } from "react";
import { Check, X, Ban, ChevronDown, ChevronUp } from "lucide-react";
import toast from "react-hot-toast";
import { leaveApi } from "../../lib/api";
import { formatDate as orgDate } from "../../lib/format";

const TYPE_LABELS = {
  annual: "Annual Leave",
  sick: "Sick Leave",
  personal: "Personal Leave",
  unpaid: "Unpaid Leave",
};

const STATUS_STYLES = {
  pending:   "bg-[hsl(var(--color-warning-soft))] text-[hsl(var(--color-warning))]",
  approved:  "bg-[hsl(var(--color-success-soft))] text-[hsl(var(--color-success))]",
  declined:  "bg-[hsl(var(--color-error-soft))] text-[hsl(var(--color-error))]",
  cancelled: "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))]",
};

const fmt = (d) =>
  d ? orgDate(d) : "—";

export default function LeaveTable({ leaveRequests, onRefresh }) {
  const [actioningId, setActioningId] = useState(null);
  const [expandedNote, setExpandedNote] = useState(null);
  const [noteInput, setNoteInput] = useState("");

  const handleAction = async (id, action) => {
    try {
      setActioningId(id);
      if (action === "approve") {
        await leaveApi.approve(id, noteInput);
        toast.success("Leave approved — employee notified");
      } else if (action === "decline") {
        if (!noteInput.trim()) {
          toast.error("Please enter a reason for declining");
          return;
        }
        await leaveApi.decline(id, noteInput);
        toast.success("Leave declined — employee notified");
      } else if (action === "cancel") {
        await leaveApi.cancel(id);
        toast.success("Leave cancelled");
      }
      setExpandedNote(null);
      setNoteInput("");
      if (onRefresh) onRefresh();
    } catch (err) {
      toast.error(err.response?.data?.message || "Action failed");
    } finally {
      setActioningId(null);
    }
  };

  const toggleNote = (id) => {
    setExpandedNote(expandedNote === id ? null : id);
    setNoteInput("");
  };

  return (
    <div className="leave-table-surface">
      <div className="overflow-x-auto">
        <ResponsiveTable className="w-full min-w-[600px]">
          <thead role="rowgroup" className="bg-[hsl(var(--color-surface-elevated))] border-b border-[hsl(var(--color-border))]">
            <tr role="row">
              {/* Always visible */}
              <th role="columnheader" scope="col" className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Employee
              </th>
              <th role="columnheader" scope="col" className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Leave Type
              </th>
              {/* Hidden on mobile */}
              <th role="columnheader" scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Start
              </th>
              <th role="columnheader" scope="col" className="hidden sm:table-cell px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                End
              </th>
              <th role="columnheader" scope="col" className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Days
              </th>
              <th role="columnheader" scope="col" className="hidden md:table-cell px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Submitted
              </th>
              {/* Always visible */}
              <th role="columnheader" scope="col" className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Status
              </th>
              {/* Hidden on mobile */}
              <th role="columnheader" scope="col" className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Notes
              </th>
              <th role="columnheader" scope="col" className="hidden lg:table-cell px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Actioned By
              </th>
              {/* Always visible */}
              <th role="columnheader" scope="col" className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                Actions
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="divide-y divide-[hsl(var(--color-border))]">
            {leaveRequests && leaveRequests.length > 0 ? (
              leaveRequests.map((req) => {
                const id = req._id;
                const isActioning = actioningId === id;
                const isExpanded = expandedNote === id;
                const employee = req.employeeId;
                const employeeName = employee
                  ? `${employee.firstName} ${employee.lastName}`
                  : "—";
                const actionedByName = req.actionedBy?.name || "—";

                return (
                  <Fragment key={id}>
                    <tr role="row" key={id} className="hover:bg-[hsl(var(--color-surface-elevated))]">
                      <td role="cell" data-label="Employee" data-field="title" className="px-4 py-3 text-sm font-medium text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {employeeName}
                      </td>
                      <td role="cell" data-label="Leave type" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {TYPE_LABELS[req.leaveType] || req.leaveType}
                      </td>
                      <td role="cell" data-label="Start date" className="hidden sm:table-cell px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {fmt(req.startDate)}
                      </td>
                      <td role="cell" data-label="End date" className="hidden sm:table-cell px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {fmt(req.endDate)}
                      </td>
                      <td role="cell" data-label="Days" className="hidden md:table-cell px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {req.periodDays ?? "—"}
                      </td>
                      <td role="cell" data-label="Submitted" className="hidden md:table-cell px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {fmt(req.createdAt)}
                      </td>
                      <td role="cell" data-label="Status" data-field="status" className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[req.status] || "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))]"}`}>
                          {req.status}
                        </span>
                      </td>
                      <td role="cell" data-label="Notes" data-field="wide" className="hidden lg:table-cell px-4 py-3 text-sm text-[hsl(var(--color-foreground))] max-w-[160px] truncate">
                        {req.notes || "—"}
                      </td>
                      <td role="cell" data-label="Actioned by" className="hidden lg:table-cell px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {actionedByName}
                      </td>
                      <td role="cell" data-label="Actions" data-field="actions" className="px-4 py-3 whitespace-nowrap">
                        {req.status === "pending" ? (
                          <div className="flex items-center gap-1">
                            <button
                              title="Approve"
                              onClick={() => handleAction(id, "approve")}
                              disabled={isActioning}
                              className="p-1.5 rounded bg-[hsl(var(--color-success-soft))] hover:bg-[hsl(var(--color-success-soft))] text-[hsl(var(--color-success))] disabled:opacity-50 transition-colors"
                            >
                              <Check className="w-3.5 h-3.5" /><span className="mobile-action-label">Approve</span>
                            </button>
                            <button
                              title="Decline (add note)"
                              onClick={() => toggleNote(id)}
                              disabled={isActioning}
                              className="p-1.5 rounded bg-[hsl(var(--color-error-soft))] hover:bg-[hsl(var(--color-error-soft))] text-[hsl(var(--color-error))] disabled:opacity-50 transition-colors"
                            >
                              <X className="w-3.5 h-3.5" /><span className="mobile-action-label">Decline</span>
                            </button>
                            <button
                              title="Cancel"
                              onClick={() => handleAction(id, "cancel")}
                              disabled={isActioning}
                              className="p-1.5 rounded bg-[hsl(var(--color-surface-elevated))] hover:bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] disabled:opacity-50 transition-colors"
                            >
                              <Ban className="w-3.5 h-3.5" /><span className="mobile-action-label">Cancel</span>
                            </button>
                            <button
                              aria-label={isExpanded ? "Hide manager note" : "Add manager note"}
                              aria-expanded={isExpanded}
                              onClick={() => toggleNote(id)}
                              className="p-1 text-[hsl(var(--color-foreground-muted))] hover:text-[hsl(var(--color-foreground-secondary))]"
                            >
                              {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                            </button>
                          </div>
                        ) : req.status === "approved" ? (
                          <button
                            title="Cancel"
                            onClick={() => handleAction(id, "cancel")}
                            disabled={isActioning}
                            className="p-1.5 rounded bg-[hsl(var(--color-surface-elevated))] hover:bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] disabled:opacity-50 transition-colors text-xs"
                          >
                            <Ban className="w-3.5 h-3.5" /><span className="mobile-action-label">Cancel</span>
                          </button>
                        ) : (
                          <span className="text-xs text-[hsl(var(--color-foreground-muted))]">—</span>
                        )}
                      </td>
                    </tr>

                    {/* Inline decline note row */}
                    {isExpanded && req.status === "pending" && (
                      <tr role="row" key={`${id}-note`} className="bg-[hsl(var(--color-error-soft))]">
                        <td role="cell" colSpan={10} className="px-4 py-3">
                          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                            <input
                              type="text"
                              value={noteInput}
                              onChange={(e) => setNoteInput(e.target.value)}
                              aria-label="Reason for declining"
                              placeholder="Reason for declining (required)..."
                              className="flex-1 text-sm border border-[hsl(var(--color-border))] rounded px-3 py-1.5 bg-[hsl(var(--color-card))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--color-ring))]"
                            />
                            <div className="flex gap-2">
                              <button
                                onClick={() => handleAction(id, "decline")}
                                disabled={isActioning}
                                className="px-3 py-1.5 bg-[hsl(var(--color-error))] hover:bg-[hsl(var(--color-error))] text-[hsl(var(--color-error-foreground))] text-sm rounded disabled:opacity-50 transition-colors whitespace-nowrap"
                              >
                                Confirm Decline
                              </button>
                              <button
                                onClick={() => toggleNote(null)}
                                className="px-3 py-1.5 border border-[hsl(var(--color-border))] text-[hsl(var(--color-foreground-secondary))] text-sm rounded hover:bg-[hsl(var(--color-card))] transition-colors"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            ) : (
              <tr role="row">
                <td role="cell" colSpan={10} className="px-4 py-12 text-center text-sm text-[hsl(var(--color-foreground-secondary))]">
                  No leave requests found
                </td>
              </tr>
            )}
          </tbody>
        </ResponsiveTable>
      </div>
    </div>
  );
}
