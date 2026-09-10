import Modal from "../ui/Modal";
import { useState, useEffect } from "react";
import { X, Clock, AlertCircle } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";
import { schedulerApi } from "../../lib/api";
import toast from "react-hot-toast";

export default function AddAdhocShiftModal({
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
  const [formData, setFormData] = useState({
    employeeId: selectedEmployeeId || "",
    siteId: selectedSite || "",
    date: selectedDate || new Date().toISOString().split("T")[0],
    startTime: "06:00",
    endTime: "14:00",
    breakDuration: 30,
    shiftType: "REGULAR",
    notes: "",
  });

  // Reset form when modal opens with new data
  useEffect(() => {
    if (isOpen) {
      setFormData((prev) => ({
        ...prev,
        employeeId: selectedEmployeeId || "",
        siteId: selectedSite || "",
        date: selectedDate || new Date().toISOString().split("T")[0],
      }));
    }
  }, [isOpen, selectedEmployeeId, selectedSite, selectedDate]);

  // Fetch employees when site is selected
  useEffect(() => {
    const fetchEmployees = async () => {
      if (!formData.siteId) {
        setEmployees([]);
        return;
      }

      try {
        setLoadingEmployees(true);
        const response = await schedulerApi.getSiteEmployees(formData.siteId);
        const employeesData = response.data.data;

        // Transform employee data
        const transformedEmployees = employeesData.map((emp) => ({
          id: emp.id,
          firstName: emp.firstName,
          lastName: emp.lastName,
          position: emp.position,
        }));

        setEmployees(transformedEmployees);
      } catch (err) {
        toast.error("Failed to load employees for this site");
        setEmployees([]);
      } finally {
        setLoadingEmployees(false);
      }
    };

    fetchEmployees();
  }, [formData.siteId]);

  // Calculate shift duration
  const calculateDuration = () => {
    if (!formData.startTime || !formData.endTime) return "0.00";

    const [startHour, startMin] = formData.startTime.split(":").map(Number);
    const [endHour, endMin] = formData.endTime.split(":").map(Number);

    let totalMinutes = endHour * 60 + endMin - (startHour * 60 + startMin);
    if (totalMinutes < 0) totalMinutes += 24 * 60; // Handle overnight shifts

    totalMinutes -= formData.breakDuration || 0;

    const hours = (totalMinutes / 60).toFixed(2);
    return hours;
  };

  const handleChange = (field, value) => {
    // If site changes, clear employee selection
    if (field === "siteId") {
      setFormData((prev) => ({ ...prev, [field]: value, employeeId: "" }));
    } else {
      setFormData((prev) => ({ ...prev, [field]: value }));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Validation
    if (!formData.siteId) {
      toast.error("Please select a site");
      return;
    }

    if (!formData.date || !formData.startTime || !formData.endTime) {
      toast.error("Please fill in all required fields");
      return;
    }

    // Create ISO datetime strings
    const startDateTime = new Date(`${formData.date}T${formData.startTime}:00`);
    const endDateTime = new Date(`${formData.date}T${formData.endTime}:00`);

    const shiftData = {
      employeeId: formData.employeeId || null,
      siteId: formData.siteId,
      date: formData.date,
      startTime: startDateTime.toISOString(),
      endTime: endDateTime.toISOString(),
      shiftType: formData.shiftType,
      status: "SCHEDULED",
      notes: formData.notes?.trim() || null,
      breakDuration: formData.breakDuration || 0,
      isAdhoc: true,
    };

    onSave(shiftData);
  };

  if (!isOpen) return null;

  const selectedEmployee = employees.find((e) => e.id === formData.employeeId);
  const duration = calculateDuration();

  return (
    <Modal onClose={onClose} label="Add ad hoc shift">
      <div className="modal-surface modal-responsive w-full max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        {/* Header - Orange for adhoc */}
        <div className="modal-header flex items-center justify-between p-4 border-b">
          <h2 className="text-lg font-semibold text-[hsl(var(--color-foreground))]">
            Add Adhoc{" "}
            {selectedEmployee
              ? selectedEmployee.position || "Employee"
              : "Shift"}{" "}
            Shift
          </h2>
          <button type="button" aria-label="Close dialog"
            onClick={onClose}
            className="text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))] transition-colors"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Adhoc Warning Banner */}
        <div className="bg-[hsl(var(--color-primary-soft))] border-l-4 border-[hsl(var(--color-primary))] p-4 flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-[hsl(var(--color-primary))] flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-medium text-[hsl(var(--color-primary))]">
              Adhoc Shift - Flexible Assignment
            </p>
            <p className="text-xs text-[hsl(var(--color-primary))] mt-1">
              This shift allows overlapping assignments and is useful for emergency coverage.
              The employee will be notified immediately upon creation.
            </p>
          </div>
        </div>

        {/* Form Content */}
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

            {/* Date */}
            <div>
              <Label>Date</Label>
              <Input
                type="date"
                value={formData.date}
                onChange={(e) => handleChange("date", e.target.value)}
                className="mt-1"
                required
              />
            </div>

            {/* Time and Break */}
            <div className="grid grid-cols-4 gap-4">
              <div>
                <Label>Start</Label>
                <Input
                  type="time"
                  value={formData.startTime}
                  onChange={(e) => handleChange("startTime", e.target.value)}
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <Label>End</Label>
                <Input
                  type="time"
                  value={formData.endTime}
                  onChange={(e) => handleChange("endTime", e.target.value)}
                  className="mt-1"
                  required
                />
              </div>
              <div>
                <Label>Break (mins)</Label>
                <Input
                  type="number"
                  value={formData.breakDuration}
                  onChange={(e) =>
                    handleChange("breakDuration", parseInt(e.target.value) || 0)
                  }
                  className="mt-1"
                  min="0"
                />
              </div>
              <div>
                <Label>Duration</Label>
                <div className="mt-1 flex items-center gap-2 px-3 py-2 border border-[hsl(var(--color-border))] rounded-md bg-[hsl(var(--color-surface-elevated))]">
                  <span className="font-medium text-[hsl(var(--color-foreground))]">
                    {duration}
                  </span>
                  <span className="text-sm text-[hsl(var(--color-foreground-secondary))]">
                    Hrs
                  </span>
                </div>
              </div>
            </div>

            {/* Shift Type */}
            <div className="grid grid-cols-1 gap-4">
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
            </div>

            {/* Notes */}
            <div className="border-t border-[hsl(var(--color-border))] pt-4">
              <Label>Notes</Label>
              <Textarea
                value={formData.notes}
                onChange={(e) => handleChange("notes", e.target.value)}
                placeholder="Add notes about this shift..."
                rows={4}
                className="mt-1"
              />
            </div>
          </div>

          {/* Footer */}
          <div className="modal-footer flex items-center justify-end gap-3 p-4 border-t">
            <Button type="button" variant="outline" onClick={onClose}>
              Close
            </Button>
            <Button type="submit" className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))]">
              Save Adhoc Shift
            </Button>
          </div>
        </form>
      </div>
    </Modal>
  );
}
