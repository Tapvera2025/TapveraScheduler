import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, Check, X, RotateCw, MapPin, Clock, AlertTriangle } from "lucide-react";
import { Card } from "../components/ui/Card";
import PageHeader from "../components/layout/PageHeader";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { adhocApi } from "../lib/api";
import { toast } from "react-hot-toast";
import { formatDate, formatTime, formatDateTime } from "../lib/format";

const STATUS_TABS = [
  { value: "PENDING", label: "Awaiting decision" },
  { value: "APPROVED", label: "Approved" },
  { value: "REJECTED", label: "Declined" },
  { value: "WITHDRAWN", label: "Withdrawn" },
  { value: "ALL", label: "All" },
];

const badgeFor = (status) => {
  if (status === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="error">Declined</Badge>;
  if (status === "WITHDRAWN") return <Badge variant="outline">Withdrawn</Badge>;
  return <Badge variant="warning">Pending</Badge>;
};


export default function AdhocRequests() {
  const [status, setStatus] = useState("PENDING");
  const [requests, setRequests] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [notes, setNotes] = useState({});
  const [busyId, setBusyId] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [listRes, statsRes] = await Promise.all([
        adhocApi.list({ status, limit: 50 }),
        adhocApi.getStats(),
      ]);
      setRequests(listRes.data.data.requests);
      setStats(statsRes.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load adhoc requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    load();
  }, [load]);

  const decide = async (id, approve) => {
    try {
      setBusyId(id);
      const note = notes[id] || "";
      if (approve) {
        await adhocApi.approve(id, note);
        toast.success("Request approved");
      } else {
        await adhocApi.reject(id, note);
        toast.success("Request declined");
      }
      setNotes((prev) => ({ ...prev, [id]: "" }));
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save the decision");
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="data-page">
      <PageHeader
        icon={CalendarPlus}
        eyebrow="SCHEDULING"
        title="Adhoc requests"
        description={stats ? `${stats.pending} awaiting a decision` : "Loading…"}
        actions={
          <button className="data-header-button" onClick={load} aria-label="Refresh">
            <RotateCw className="w-4 h-4" />
          </button>
        }
      />
      <div className="data-page-body">

      <div className="sm:w-64 mb-4">
        <Select value={status} onChange={(e) => setStatus(e.target.value)}>
          {STATUS_TABS.map((tab) => (
            <option key={tab.value} value={tab.value}>
              {tab.label}
            </option>
          ))}
        </Select>
      </div>

      {loading ? (
        <Card className="p-10 text-center text-[hsl(var(--color-foreground-secondary))]">
          Loading...
        </Card>
      ) : requests.length === 0 ? (
        <Card className="p-10 text-center text-[hsl(var(--color-foreground-secondary))]">
          <CalendarPlus className="w-8 h-8 mx-auto mb-2 opacity-40" />
          Nothing here
        </Card>
      ) : (
        <div className="space-y-3">
          {requests.map((request) => {
            const employee = request.employeeId;
            const site = request.siteId;
            const isPending = request.approvalStatus === "PENDING";

            return (
              <Card key={request.id} className="p-4 sm:p-5">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-semibold text-[hsl(var(--color-foreground))]">
                        {employee ? `${employee.firstName} ${employee.lastName}` : "Unknown employee"}
                      </p>
                      {badgeFor(request.approvalStatus)}
                      {request.shiftType !== "REGULAR" && (
                        <Badge variant="info">{request.shiftType}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-1 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5" />
                      {site?.siteLocationName || "Unknown site"}
                    </p>
                    <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(request.date)} · {formatTime(request.startTime)}–{formatTime(request.endTime)}
                    </p>
                    {request.requestReason && (
                      <p className="text-sm text-[hsl(var(--color-foreground))] mt-2">
                        <span className="text-[hsl(var(--color-foreground-secondary))]">Reason: </span>
                        {request.requestReason}
                      </p>
                    )}
                    {request.employeeAssignedToSite === false && (
                      <p className="text-xs text-[hsl(var(--color-warning))] mt-2 flex items-center gap-1.5">
                        <AlertTriangle className="w-3.5 h-3.5" />
                        This employee is not assigned to that site
                      </p>
                    )}
                    {!isPending && (
                      <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-2">
                        {request.reviewedBy?.name
                          ? `Decided by ${request.reviewedBy.name}`
                          : "Decided"}
                        {request.reviewedAt ? ` on ${formatDateTime(request.reviewedAt)}` : ""}
                        {request.reviewNote ? ` — "${request.reviewNote}"` : ""}
                      </p>
                    )}
                  </div>

                  {isPending && (
                    <div className="flex flex-col gap-2 w-full sm:w-72">
                      <Input
                        value={notes[request.id] || ""}
                        onChange={(e) =>
                          setNotes((prev) => ({ ...prev, [request.id]: e.target.value }))
                        }
                        placeholder="Note (optional)"
                      />
                      <div className="flex gap-2">
                        <Button
                          className="flex-1"
                          disabled={busyId === request.id}
                          onClick={() => decide(request.id, true)}
                        >
                          <Check className="w-4 h-4" /> Approve
                        </Button>
                        <Button
                          variant="danger"
                          className="flex-1"
                          disabled={busyId === request.id}
                          onClick={() => decide(request.id, false)}
                        >
                          <X className="w-4 h-4" /> Decline
                        </Button>
                      </div>
                    </div>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </div>
    </div>
  );
}
