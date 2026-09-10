import { useCallback, useEffect, useState } from "react";
import { CalendarPlus, MapPin, Clock, RotateCw, Undo2 } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Label } from "../../components/ui/Label";
import { Select } from "../../components/ui/Select";
import { Textarea } from "../../components/ui/Textarea";
import { Badge } from "../../components/ui/Badge";
import { adhocApi, schedulerApi } from "../../lib/api";
import { toast } from "react-hot-toast";
import { formatDate, formatTime } from "../../lib/format";

const today = () => new Date().toISOString().split("T")[0];

const badgeFor = (status) => {
  if (status === "APPROVED") return <Badge variant="success">Approved</Badge>;
  if (status === "REJECTED") return <Badge variant="error">Declined</Badge>;
  if (status === "WITHDRAWN") return <Badge variant="outline">Withdrawn</Badge>;
  return <Badge variant="warning">Awaiting decision</Badge>;
};


export default function MyAdhoc() {
  const [sites, setSites] = useState([]);
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    siteId: "",
    date: today(),
    startTime: "06:00",
    endTime: "14:00",
    shiftType: "REGULAR",
    requestReason: "",
  });

  const loadRequests = useCallback(async () => {
    try {
      setLoading(true);
      const res = await adhocApi.getMy();
      setRequests(res.data.data);
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load your requests");
      setRequests([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadRequests();
  }, [loadRequests]);

  useEffect(() => {
    const loadSites = async () => {
      try {
        const res = await schedulerApi.getSites();
        setSites(res.data.data || []);
      } catch {
        // Not fatal — the employee just cannot pick a site until this works
        toast.error("Could not load the site list");
      }
    };
    loadSites();
  }, []);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));

  const hours = (() => {
    if (!form.startTime || !form.endTime) return null;
    const [sh, sm] = form.startTime.split(":").map(Number);
    const [eh, em] = form.endTime.split(":").map(Number);
    let minutes = eh * 60 + em - (sh * 60 + sm);
    if (minutes <= 0) return null;
    return (minutes / 60).toFixed(2);
  })();

  const submit = async (e) => {
    e.preventDefault();

    if (!form.siteId) {
      toast.error("Pick a site");
      return;
    }
    if (!hours) {
      toast.error("The end time must be after the start time");
      return;
    }

    try {
      setSaving(true);
      await adhocApi.request({
        siteId: form.siteId,
        date: form.date,
        startTime: new Date(`${form.date}T${form.startTime}:00`).toISOString(),
        endTime: new Date(`${form.date}T${form.endTime}:00`).toISOString(),
        shiftType: form.shiftType,
        requestReason: form.requestReason,
      });
      toast.success("Request sent for approval");
      setForm((prev) => ({ ...prev, requestReason: "" }));
      await loadRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not send the request");
    } finally {
      setSaving(false);
    }
  };

  const withdraw = async (id) => {
    try {
      await adhocApi.withdraw(id);
      toast.success("Request withdrawn");
      await loadRequests();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not withdraw the request");
    }
  };

  return (
    <div className="portal-page overflow-y-auto">
      <div className="portal-content max-w-3xl">
        <div className="portal-heading"><h1 className="text-2xl sm:text-3xl font-bold text-[hsl(var(--color-foreground))]">
          Adhoc shifts
        </h1>
        <p className="text-sm text-[hsl(var(--color-foreground-secondary))]">
          Ask for an extra shift. A manager approves it before it becomes real
          work, so you cannot clock in until then.
        </p></div>

        {/* Request form */}
        <Card className="portal-surface p-5 sm:p-6 mb-6">
          <form onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="sm:col-span-2">
              <Label htmlFor="siteId">Site *</Label>
              <Select
                id="siteId"
                value={form.siteId}
                onChange={(e) => setField("siteId", e.target.value)}
                className="mt-1.5"
              >
                <option value="">Choose a site...</option>
                {sites.map((site) => (
                  <option key={site.id || site._id} value={site.id || site._id}>
                    {site.siteLocationName || site.shortName}
                  </option>
                ))}
              </Select>
            </div>

            <div>
              <Label htmlFor="date">Date *</Label>
              <Input
                id="date"
                type="date"
                min={today()}
                value={form.date}
                onChange={(e) => setField("date", e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="shiftType">Type</Label>
              <Select
                id="shiftType"
                value={form.shiftType}
                onChange={(e) => setField("shiftType", e.target.value)}
                className="mt-1.5"
              >
                <option value="REGULAR">Regular</option>
                <option value="OVERTIME">Overtime</option>
                <option value="NIGHT">Night</option>
                <option value="ON_CALL">On call</option>
              </Select>
            </div>

            <div>
              <Label htmlFor="startTime">Start *</Label>
              <Input
                id="startTime"
                type="time"
                value={form.startTime}
                onChange={(e) => setField("startTime", e.target.value)}
                className="mt-1.5"
              />
            </div>

            <div>
              <Label htmlFor="endTime">End *</Label>
              <Input
                id="endTime"
                type="time"
                value={form.endTime}
                onChange={(e) => setField("endTime", e.target.value)}
                className="mt-1.5"
              />
              {hours && (
                <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1.5">
                  {hours} hours
                </p>
              )}
            </div>

            <div className="sm:col-span-2">
              <Label htmlFor="requestReason">Reason (optional)</Label>
              <Textarea
                id="requestReason"
                value={form.requestReason}
                onChange={(e) => setField("requestReason", e.target.value)}
                placeholder="Anything the manager should know"
                rows={3}
                className="mt-1.5"
              />
            </div>

            <div className="sm:col-span-2">
              <Button type="submit" disabled={saving}>
                <CalendarPlus className="w-4 h-4" />
                {saving ? "Sending..." : "Request shift"}
              </Button>
            </div>
          </form>
        </Card>

        {/* My requests */}
        <div className="flex items-center justify-between mb-3">
          <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))]">
            My requests
          </h2>
          <Button variant="outline" size="sm" onClick={loadRequests}>
            <RotateCw className="w-4 h-4" />
          </Button>
        </div>

        {loading ? (
          <Card className="p-8 text-center text-[hsl(var(--color-foreground-secondary))]">
            Loading...
          </Card>
        ) : requests.length === 0 ? (
          <Card className="p-8 text-center text-[hsl(var(--color-foreground-secondary))]">
            You have not requested any adhoc shifts yet
          </Card>
        ) : (
          <div className="space-y-3">
            {requests.map((request) => (
              <Card key={request.id} className="p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {badgeFor(request.approvalStatus)}
                      {request.shiftType !== "REGULAR" && (
                        <Badge variant="info">{request.shiftType}</Badge>
                      )}
                    </div>
                    <p className="text-sm text-[hsl(var(--color-foreground))] mt-2 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-[hsl(var(--color-foreground-muted))]" />
                      {request.siteId?.siteLocationName || "Unknown site"}
                    </p>
                    <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5 flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(request.date)} · {formatTime(request.startTime)}–{formatTime(request.endTime)}
                    </p>
                    {request.reviewNote && (
                      <p className="text-sm text-[hsl(var(--color-foreground))] mt-2">
                        <span className="text-[hsl(var(--color-foreground-secondary))]">
                          Manager&apos;s note:{" "}
                        </span>
                        {request.reviewNote}
                      </p>
                    )}
                  </div>

                  {request.approvalStatus === "PENDING" && (
                    <Button variant="outline" size="sm" onClick={() => withdraw(request.id)}>
                      <Undo2 className="w-4 h-4" /> Withdraw
                    </Button>
                  )}
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
