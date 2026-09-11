import Modal from "../ui/Modal";
import { useState, useEffect } from "react";
import { X, Clock } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";
import { schedulerApi } from "../../lib/api";
import toast from "react-hot-toast";

function calcDuration(startTime, endTime, breakDuration) {
  if (!startTime || !endTime) return "0.00";
  const [sh, sm] = startTime.split(":").map(Number);
  const [eh, em] = endTime.split(":").map(Number);
  let total = eh * 60 + em - (sh * 60 + sm);
  if (total < 0) total += 24 * 60;
  total -= breakDuration || 0;
  return (total / 60).toFixed(2);
}

function toTimeStr(isoString) {
  if (!isoString) return "06:00";
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

export default function EditShiftModal({ isOpen, onClose, onSave, shift, sites = [] }) {
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  const [formData, setFormData] = useState({
    employeeId: "",
    siteId: "",
    startTime: "06:00",
    endTime: "14:00",
    breakDuration: 30,
    shiftType: "REGULAR",
    notes: "",
  });

  useEffect(() => {
    if (isOpen && shift) {
      const rawSiteId = shift.siteId
        ? typeof shift.siteId === "object"
          ? shift.siteId.id || shift.siteId._id
          : shift.siteId
        : "";

      const rawEmployeeId = shift.employeeId
        ? typeof shift.employeeId === "object"
          ? shift.employeeId.id || shift.employeeId._id
          : shift.employeeId
        : "";

      setFormData({
        employeeId: rawEmployeeId || "",
        siteId: rawSiteId || "",
        startTime: toTimeStr(shift.startTime),
        endTime: toTimeStr(shift.endTime),
        breakDuration: shift.breakDuration || 0,
        shiftType: shift.shiftType || "REGULAR",
        notes: shift.notes || "",
      });
    }
  }, [isOpen, shift]);

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

  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!formData.siteId) { toast.error("Please select a site"); return; }

    const shiftDate = shift.date
      ? new Date(shift.date).toISOString().split("T")[0]
      : new Date().toISOString().split("T")[0];

    const startDateTime = new Date(`${shiftDate}T${formData.startTime}:00`);
    const endDateTime = new Date(`${shiftDate}T${formData.endTime}:00`);

    const payload = {
      employeeId: formData.employeeId || null,
      siteId: formData.siteId,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      shiftType: formData.shiftType,
      notes: formData.notes?.trim() || null,
      breakDuration: formData.breakDuration || 0,
    };

    onSave(shift.id, payload);
  };

  if (!isOpen || !shift) return null;

  const selectedEmployee = employees.find((e) => e.id === formData.employeeId);
  const duration = calcDuration(formData.startTime, formData.endTime, formData.breakDuration);

  const shiftDateLabel = shift.date
    ? new Date(shift.date).toLocaleDateString("en-GB", {
        weekday: "short",
        day: "numeric",
        month: "short",
        year: "numeric",
      })
    : "";

  return (
    <Modal onClose={onClose} label="Edit shift">
      <div className="modal-surface modal-responsive w-full max-w-lg max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="modal-header flex items-center justify-between p-4 border-b">
          <div>
            <h2 className="text-lg font-semibold text-[hsl(var(--color-foreground))]">
              Edit Shift
            </h2>
            {shiftDateLabel && (
              <p className="text-xs text-[hsl(var(--color-foreground-secondary))] mt-0.5">
                {shiftDateLabel}
              </p>
            )}
          </div>
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

            {/* Timing */}
            <div className="border border-[hsl(var(--color-border))] rounded-lg overflow-hidden">
              <div className="bg-[hsl(var(--color-surface-elevated))] px-4 py-2 border-b border-[hsl(var(--color-border))]">
                <span className="text-sm font-medium text-[hsl(var(--color-foreground))]">
                  Shift Timing
                </span>
              </div>
              <div className="grid items-center gap-4 px-4 py-3" style={{ gridTemplateColumns: "1fr 1fr 1fr 80px" }}>
                <div>
                  <span className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1 block">Start</span>
                  <Input
                    type="time"
                    value={formData.startTime}
                    onChange={(e) => handleChange("startTime", e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div>
                  <span className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1 block">End</span>
                  <Input
                    type="time"
                    value={formData.endTime}
                    onChange={(e) => handleChange("endTime", e.target.value)}
                    className="text-xs"
                  />
                </div>
                <div>
                  <span className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1 block">Break (min)</span>
                  <Input
                    type="number"
                    value={formData.breakDuration}
                    onChange={(e) => handleChange("breakDuration", parseInt(e.target.value) || 0)}
                    min="0"
                    className="text-xs"
                  />
                </div>
                <div className="flex items-center gap-1 text-xs font-medium text-[hsl(var(--color-foreground))]">
                  <Clock className="h-3 w-3 text-[hsl(var(--color-foreground-secondary))]" />
                  {duration}h
                </div>
              </div>
            </div>

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
          <div className="modal-footer flex items-center justify-end gap-3 p-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary">
              Save Changes
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
