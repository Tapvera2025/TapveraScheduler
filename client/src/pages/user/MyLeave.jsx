import Modal from "../../components/ui/Modal";
import ResponsiveTable from "../../components/ui/ResponsiveTable";
import { useState, useEffect, useCallback } from "react";
import { Plus, RotateCcw, X, Ban } from "lucide-react";
import toast from "react-hot-toast";
import { leaveApi } from "../../lib/api";
import { Button } from "../../components/ui/Button";
import { Select } from "../../components/ui/Select";
import { Input } from "../../components/ui/Input";
import { Textarea } from "../../components/ui/Textarea";
import { Label } from "../../components/ui/Label";
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

function calcDays(start, end) {
  if (!start || !end) return 0;
  const s = new Date(start);
  const e = new Date(end);
  if (e < s) return 0;
  let count = 0;
  const cur = new Date(s);
  while (cur <= e) {
    const d = cur.getDay();
    if (d !== 0 && d !== 6) count++;
    cur.setDate(cur.getDate() + 1);
  }
  return count || 1;
}

// ─── New Leave Modal ──────────────────────────────────────────────────────────
function NewLeaveModal({ onClose, onSuccess }) {
  const [form, setForm] = useState({
    leaveType: "",
    startDate: "",
    endDate: "",
    fullDay: true,
    notes: "",
  });
  const [submitting, setSubmitting] = useState(false);

  const days = calcDays(form.startDate, form.endDate);

  const handleSubmit = async () => {
    if (!form.leaveType) return toast.error("Please select a leave type");
    if (!form.startDate) return toast.error("Please select a start date");
    if (!form.endDate) return toast.error("Please select an end date");
    if (new Date(form.endDate) < new Date(form.startDate))
      return toast.error("End date must be on or after start date");

    try {
      setSubmitting(true);
      await leaveApi.submitMy(form);
      toast.success("Leave request submitted — your manager will be notified");
      onSuccess();
      onClose();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to submit leave request");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} label="Request leave">
      <div className="modal-surface w-full max-w-lg">
        <div className="modal-header flex items-center justify-between px-5 py-4 border-b">
          <h2 className="text-base font-semibold text-[hsl(var(--color-foreground))]">Request Leave</h2>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="px-5 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label>Leave Type</Label>
            <Select value={form.leaveType} onChange={(e) => setForm({ ...form, leaveType: e.target.value })}>
              <option value="">Select Type...</option>
              <option value="annual">Annual Leave</option>
              <option value="sick">Sick Leave</option>
              <option value="personal">Personal Leave</option>
              <option value="unpaid">Unpaid Leave</option>
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Start Date</Label>
              <Input type="date" value={form.startDate} onChange={(e) => setForm({ ...form, startDate: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>End Date</Label>
              <Input type="date" value={form.endDate} min={form.startDate} onChange={(e) => setForm({ ...form, endDate: e.target.value })} />
            </div>
          </div>

          <div className="flex items-center gap-4">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={form.fullDay}
                onChange={(e) => setForm({ ...form, fullDay: e.target.checked })}
                className="w-4 h-4 rounded"
              />
              <span className="text-sm font-medium text-[hsl(var(--color-foreground))]">Full Day(s)</span>
            </label>
            {days > 0 && (
              <span className="text-sm text-[hsl(var(--color-foreground-secondary))]">
                <strong>{days}</strong> working day{days !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          <div className="space-y-1.5">
            <Label>Reason / Notes</Label>
            <Textarea
              value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}
              placeholder="Provide a brief reason for your leave..."
              rows={3}
            />
          </div>
        </div>

        <div className="modal-footer px-5 py-4 border-t flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting}
            className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary-dark))] text-[hsl(var(--color-primary-foreground))]"
          >
            {submitting ? "Submitting..." : "Submit Request"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────
export default function MyLeave() {
  const [leaves, setLeaves] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showModal, setShowModal] = useState(false);
  const [cancellingId, setCancellingId] = useState(null);
  const [statusFilter, setStatusFilter] = useState("all");

  const fetchLeaves = useCallback(async () => {
    try {
      setLoading(true);
      const res = await leaveApi.getMy({
        status: statusFilter !== "all" ? statusFilter : undefined,
        limit: 50,
      });
      setLeaves(res.data.data.leaves || []);
    } catch (err) {
      toast.error("Failed to load your leave requests");
    } finally {
      setLoading(false);
    }
  }, [statusFilter]);

  useEffect(() => {
    fetchLeaves();
  }, [fetchLeaves]);

  const handleCancel = async (id) => {
    try {
      setCancellingId(id);
      await leaveApi.cancelMy(id);
      toast.success("Leave request cancelled");
      fetchLeaves();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to cancel");
    } finally {
      setCancellingId(null);
    }
  };

  return (
    <div className="data-page flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div className="data-page-header px-5 py-4 flex items-center justify-between flex-shrink-0">
        <h1 className="text-base font-semibold">My Leave</h1>
        <button onClick={fetchLeaves} className="p-1.5 hover:bg-[hsl(var(--color-primary-dark))] rounded transition-colors">
          <RotateCcw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Actions bar */}
      <div className="px-5 py-3 bg-[hsl(var(--color-card))] border-b border-[hsl(var(--color-border))] flex items-center justify-between gap-3 flex-shrink-0">
        <Select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="w-44"
        >
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="approved">Approved</option>
          <option value="declined">Declined</option>
          <option value="cancelled">Cancelled</option>
        </Select>

        <Button
          onClick={() => setShowModal(true)}
          className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary-dark))] text-[hsl(var(--color-primary-foreground))] flex items-center gap-2"
        >
          <Plus className="w-4 h-4" />
          Request Leave
        </Button>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-auto p-5">
        {loading ? (
          <div className="flex items-center justify-center h-48 text-sm text-[hsl(var(--color-foreground-secondary))]">
            Loading your leave requests...
          </div>
        ) : leaves.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-48 gap-3 text-[hsl(var(--color-foreground-secondary))]">
            <p className="text-sm">You have no leave requests yet.</p>
            <Button
              onClick={() => setShowModal(true)}
              className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary-dark))] text-[hsl(var(--color-primary-foreground))] flex items-center gap-2"
            >
              <Plus className="w-4 h-4" />
              Request Leave
            </Button>
          </div>
        ) : (
          <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-lg overflow-hidden shadow-sm">
            <div className="overflow-x-auto">
              <ResponsiveTable className="w-full">
                <thead role="rowgroup" className="bg-[hsl(var(--color-surface-elevated))] border-b border-[hsl(var(--color-border))]">
                  <tr role="row">
                    {["Leave Type", "Start Date", "End Date", "Days", "Submitted", "Status", "Manager Note", "Action"].map((col) => (
                      <th role="columnheader" scope="col" key={col} className="px-4 py-3 text-left text-xs font-medium text-[hsl(var(--color-foreground-secondary))] uppercase tracking-wider whitespace-nowrap">
                        {col}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody role="rowgroup" className="divide-y divide-[hsl(var(--color-border))]">
                  {leaves.map((leave) => (
                    <tr role="row" key={leave._id} className="hover:bg-[hsl(var(--color-surface-elevated))]">
                      <td role="cell" data-label="Leave type" data-field="title" className="px-4 py-3 text-sm font-medium text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {TYPE_LABELS[leave.leaveType] || leave.leaveType}
                      </td>
                      <td role="cell" data-label="Start date" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {fmt(leave.startDate)}
                      </td>
                      <td role="cell" data-label="End date" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {fmt(leave.endDate)}
                      </td>
                      <td role="cell" data-label="Days" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {leave.periodDays ?? "—"}
                      </td>
                      <td role="cell" data-label="Submitted" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground))] whitespace-nowrap">
                        {fmt(leave.createdAt)}
                      </td>
                      <td role="cell" data-label="Status" data-field="status" className="px-4 py-3 whitespace-nowrap">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_STYLES[leave.status] || "bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))]"}`}>
                          {leave.status}
                        </span>
                      </td>
                      <td role="cell" data-label="Manager note" data-field="wide" className="px-4 py-3 text-sm text-[hsl(var(--color-foreground))] max-w-[200px] truncate">
                        {leave.actionNote || "—"}
                      </td>
                      <td role="cell" data-label="Actions" data-field="actions" className="px-4 py-3 whitespace-nowrap">
                        {["pending", "approved"].includes(leave.status) ? (
                          <button
                            onClick={() => handleCancel(leave._id)}
                            disabled={cancellingId === leave._id}
                            title="Cancel request"
                            className="p-1.5 rounded bg-[hsl(var(--color-surface-elevated))] hover:bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] disabled:opacity-50 transition-colors"
                          >
                            <Ban className="w-3.5 h-3.5" /><span className="mobile-action-label">Cancel request</span>
                          </button>
                        ) : (
                          <span className="text-xs text-[hsl(var(--color-foreground-muted))]">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </ResponsiveTable>
            </div>
          </div>
        )}
      </div>

      {showModal && (
        <NewLeaveModal
          onClose={() => setShowModal(false)}
          onSuccess={fetchLeaves}
        />
      )}
    </div>
  );
}
