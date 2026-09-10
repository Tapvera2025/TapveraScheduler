import Modal from "../ui/Modal";
import { useState, useEffect, useMemo } from "react";
import { X, Copy, Clock } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";
import { schedulerApi } from "../../lib/api";
import toast from "react-hot-toast";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function toLocalDateStr(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function calcDuration(startTime, endTime, breakDuration) {
  if (!startTime || !endTime) return "0.00";
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let total = eh * 60 + em - (sh * 60 + sm);
  if (total < 0) total += 24 * 60;
  total -= breakDuration || 0;
  return (total / 60).toFixed(2);
}

function buildDateEntries(startDate, endDate, defaultStart, defaultEnd, defaultBreak) {
  if (!startDate || !endDate) return [];
  const entries = [];
  const cur = new Date(startDate + "T00:00:00");
  const end = new Date(endDate + "T00:00:00");
  if (cur > end) return [];
  while (cur <= end) {
    entries.push({
      date: toLocalDateStr(cur),
      dayName: DAYS[cur.getDay()],
      startTime: defaultStart,
      endTime: defaultEnd,
      breakDuration: defaultBreak,
      enabled: true,
    });
    cur.setDate(cur.getDate() + 1);
  }
  return entries;
}

export default function AddShiftModal({
  isOpen,
  onClose,
  onSave,
  sites = [],
  selectedSite,
  selectedDate,
  selectedEmployeeId = null,
}) {
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const todayStr = toLocalDateStr(new Date());

  const [formData, setFormData] = useState({
    employeeId: selectedEmployeeId || "",
    siteId: selectedSite || "",
    startDate: selectedDate || todayStr,
    endDate: selectedDate || todayStr,
    shiftType: "REGULAR",
    notes: "",
  });

  const [dateEntries, setDateEntries] = useState(() =>
    buildDateEntries(
      selectedDate || todayStr,
      selectedDate || todayStr,
      "06:00",
      "14:00",
      30
    )
  );

  useEffect(() => {
    if (isOpen) {
      const sd = selectedDate || todayStr;
      setFormData({
        employeeId: selectedEmployeeId || "",
        siteId: selectedSite || "",
        startDate: sd,
        endDate: sd,
        shiftType: "REGULAR",
        notes: "",
      });
      setDateEntries(buildDateEntries(sd, sd, "06:00", "14:00", 30));
    }
  }, [isOpen, selectedEmployeeId, selectedSite, selectedDate]);

  // Rebuild date entries when date range changes, preserving existing timings
  const handleRangeChange = (field, value) => {
    const newFormData = { ...formData, [field]: value };
    setFormData(newFormData);

    const { startDate, endDate } = newFormData;
    if (!startDate || !endDate || startDate > endDate) return;

    setDateEntries((prev) => {
      const prevMap = Object.fromEntries(prev.map((e) => [e.date, e]));
      return buildDateEntries(startDate, endDate, "06:00", "14:00", 30).map((e) =>
        prevMap[e.date] ? { ...prevMap[e.date] } : e
      );
    });
  };

  useEffect(() => {
    const fetchEmployees = async () => {
      if (!formData.siteId) { setEmployees([]); return; }
      try {
        setLoadingEmployees(true);
        const response = await schedulerApi.getSiteEmployees(formData.siteId);
        setEmployees(
          response.data.data.map((emp) => ({
            id: emp.id,
            firstName: emp.firstName,
            lastName: emp.lastName,
            position: emp.position,
          }))
        );
      } catch {
        toast.error("Failed to load employees for this site");
        setEmployees([]);
      } finally {
        setLoadingEmployees(false);
      }
    };
    fetchEmployees();
  }, [formData.siteId]);

  const handleChange = (field, value) => {
    if (field === "siteId") {
      setFormData((prev) => ({ ...prev, siteId: value, employeeId: "" }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
  };

  const updateEntry = (index, field, value) => {
    setDateEntries((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e))
    );
  };

  const copyTimingToAll = (sourceIndex) => {
    const src = dateEntries[sourceIndex];
    setDateEntries((prev) =>
      prev.map((e) => ({
        ...e,
        startTime: src.startTime,
        endTime: src.endTime,
        breakDuration: src.breakDuration,
      }))
    );
    toast.success("Timing copied to all days");
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.siteId) { toast.error("Please select a site"); return; }
    if (!formData.startDate || !formData.endDate) {
      toast.error("Please select a date range");
      return;
    }
    if (formData.startDate > formData.endDate) {
      toast.error("End date must be on or after start date");
      return;
    }

    const enabledEntries = dateEntries.filter((e) => e.enabled);
    if (enabledEntries.length === 0) {
      toast.error("Please enable at least one day");
      return;
    }

    const shifts = enabledEntries.map((entry) => {
      const startDateTime = new Date(`${entry.date}T${entry.startTime}:00`);
      const endDateTime = new Date(`${entry.date}T${entry.endTime}:00`);
      return {
        employeeId: formData.employeeId || null,
        siteId: formData.siteId,
        date: entry.date,
        startTime: startDateTime.toISOString(),
        endTime: endDateTime.toISOString(),
        shiftType: formData.shiftType,
        status: "SCHEDULED",
        notes: formData.notes?.trim() || null,
        breakDuration: entry.breakDuration || 0,
      };
    });

    onSave(shifts.length === 1 ? shifts[0] : shifts);
  };

  if (!isOpen) return null;

  const selectedEmployee = employees.find((e) => e.id === formData.employeeId);
  const isMultiDay = dateEntries.length > 1;

  return (
    <Modal onClose={onClose} label="Add shift">
      <div className="modal-surface modal-responsive w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="modal-header flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-[hsl(var(--color-foreground))]">
            Add {selectedEmployee ? selectedEmployee.position || "Employee" : "Shift"}
          </h2>
          <button
            type="button"
            aria-label="Close dialog"
            onClick={onClose}
            className="text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto">
          <div className="p-6 space-y-4">
            {/* Site */}
            <div>
              <Label>Site *</Label>
              <Select
                value={formData.siteId}
                onChange={(e) => handleChange("siteId", e.target.value)}
                className="mt-1"
                required
              >
                <option value="">Select Site...</option>
                {sites.map((site) => (
                  <option key={site.id} value={site.id}>
                    {site.shortName} - {site.siteLocationName}
                  </option>
                ))}
              </Select>
            </div>

            {/* Employee and Position */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label>Employee</Label>
                <Select
                  value={formData.employeeId}
                  onChange={(e) => handleChange("employeeId", e.target.value)}
                  className="mt-1"
                  disabled={!formData.siteId || loadingEmployees}
                >
                  {!formData.siteId ? (
                    <option value="">Select site first...</option>
                  ) : loadingEmployees ? (
                    <option value="">Loading employees...</option>
                  ) : (
                    <>
                      <option value="">Open Shift</option>
                      {employees.map((emp) => (
                        <option key={emp.id} value={emp.id}>
                          {emp.firstName} {emp.lastName} - {emp.position}
                        </option>
                      ))}
                    </>
                  )}
                </Select>
              </div>
              <div>
                <Label>Position</Label>
                <Input
                  value={selectedEmployee?.position || "N/A"}
                  disabled
                  className="mt-1 bg-[hsl(var(--color-surface-elevated))]"
                />
              </div>
            </div>

            {/* Date Range */}
            <div>
              <Label>Date Range</Label>
              <div className="grid grid-cols-2 gap-4 mt-1">
                <div>
                  <span className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1 block">From</span>
                  <Input
                    type="date"
                    value={formData.startDate}
                    onChange={(e) => handleRangeChange("startDate", e.target.value)}
                    required
                  />
                </div>
                <div>
                  <span className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1 block">To</span>
                  <Input
                    type="date"
                    value={formData.endDate}
                    min={formData.startDate}
                    onChange={(e) => handleRangeChange("endDate", e.target.value)}
                    required
                  />
                </div>
              </div>
            </div>

            {/* Per-day shift timing */}
            {dateEntries.length > 0 && (
              <div className="border border-[hsl(var(--color-border))] rounded-lg overflow-hidden">
                <div className="bg-[hsl(var(--color-surface-elevated))] px-4 py-2 border-b border-[hsl(var(--color-border))] flex items-center justify-between">
                  <span className="text-sm font-medium text-[hsl(var(--color-foreground))]">
                    {isMultiDay
                      ? `Shift Timing — ${dateEntries.filter((e) => e.enabled).length} of ${dateEntries.length} days selected`
                      : "Shift Timing"}
                  </span>
                  {isMultiDay && (
                    <span className="text-xs text-[hsl(var(--color-foreground-secondary))]">
                      Use <Copy className="inline h-3 w-3" /> to copy a row's timing to all days
                    </span>
                  )}
                </div>

                {/* Column headers */}
                <div className="grid items-center gap-2 px-4 py-2 bg-[hsl(var(--color-surface-elevated))] border-b border-[hsl(var(--color-border))] text-xs text-[hsl(var(--color-foreground-secondary))] font-medium"
                  style={{ gridTemplateColumns: isMultiDay ? "auto 1fr 1fr 1fr 80px auto" : "1fr 1fr 1fr 80px" }}
                >
                  {isMultiDay && <span></span>}
                  {isMultiDay && <span>Day</span>}
                  <span>Start</span>
                  <span>End</span>
                  <span>Break (min)</span>
                  <span>Duration</span>
                  {isMultiDay && <span></span>}
                </div>

                <div className="divide-y divide-[hsl(var(--color-border))] max-h-64 overflow-y-auto">
                  {dateEntries.map((entry, i) => {
                    const duration = calcDuration(entry.startTime, entry.endTime, entry.breakDuration);
                    return (
                      <div
                        key={entry.date}
                        className={`grid items-center gap-2 px-4 py-2 ${!entry.enabled ? "opacity-40" : ""}`}
                        style={{ gridTemplateColumns: isMultiDay ? "auto 1fr 1fr 1fr 80px auto" : "1fr 1fr 1fr 80px" }}
                      >
                        {isMultiDay && (
                          <input
                            type="checkbox"
                            checked={entry.enabled}
                            onChange={(e) => updateEntry(i, "enabled", e.target.checked)}
                            className="rounded border-[hsl(var(--color-border))] accent-[hsl(var(--color-primary))]"
                          />
                        )}
                        {isMultiDay && (
                          <div>
                            <div className="text-xs font-semibold text-[hsl(var(--color-foreground))]">
                              {entry.dayName}
                            </div>
                            <div className="text-[10px] text-[hsl(var(--color-foreground-secondary))]">
                              {entry.date}
                            </div>
                          </div>
                        )}
                        <Input
                          type="time"
                          value={entry.startTime}
                          disabled={!entry.enabled}
                          onChange={(e) => updateEntry(i, "startTime", e.target.value)}
                          className="text-xs"
                        />
                        <Input
                          type="time"
                          value={entry.endTime}
                          disabled={!entry.enabled}
                          onChange={(e) => updateEntry(i, "endTime", e.target.value)}
                          className="text-xs"
                        />
                        <Input
                          type="number"
                          value={entry.breakDuration}
                          disabled={!entry.enabled}
                          onChange={(e) => updateEntry(i, "breakDuration", parseInt(e.target.value) || 0)}
                          min="0"
                          className="text-xs"
                        />
                        <div className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--color-foreground))]">
                          <Clock className="h-3 w-3 text-[hsl(var(--color-foreground-secondary))]" />
                          {duration}h
                        </div>
                        {isMultiDay && (
                          <button
                            type="button"
                            onClick={() => copyTimingToAll(i)}
                            disabled={!entry.enabled}
                            title="Copy this timing to all days"
                            className="p-1 rounded hover:bg-[hsl(var(--color-surface-elevated))] text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-primary))] transition-colors disabled:opacity-30"
                          >
                            <Copy className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {/* Shift Type */}
            <div>
              <Label>Shift Type</Label>
              <Select
                value={formData.shiftType}
                onChange={(e) => handleChange("shiftType", e.target.value)}
                className="mt-1"
              >
                <option value="REGULAR">Normal Shift</option>
                <option value="OVERTIME">Overtime</option>
                <option value="ON_CALL">On Call</option>
                <option value="NIGHT">Night Shift</option>
              </Select>
            </div>

            {/* Notes */}
            <div className="border-t border-[hsl(var(--color-border))] pt-4">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                placeholder="Add notes about this shift..."
                rows={3}
                className="mt-1"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer flex items-center justify-between gap-3 p-4 border-t">
            <div className="text-xs text-[hsl(var(--color-foreground-secondary))]">
              {dateEntries.filter((e) => e.enabled).length > 1 &&
                `${dateEntries.filter((e) => e.enabled).length} shifts will be created`}
            </div>
            <div className="flex items-center gap-3">
              <Button type="button" variant="outline" onClick={onClose}>
                Close
              </Button>
              <Button type="submit" variant="primary">
                Save{dateEntries.filter((e) => e.enabled).length > 1
                  ? ` (${dateEntries.filter((e) => e.enabled).length})`
                  : ""}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </Modal>
  );
}
