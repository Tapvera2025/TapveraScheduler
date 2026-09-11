import Modal from "../ui/Modal";
import { useState } from "react";
import { X, Building2, Save } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { StateInput } from "../ui/StateInput";
import { clientApi } from "../../lib/api";

export default function AddClientModal({ onClose, onSuccess, client = null }) {

  // API state
  const [submitting, setSubmitting] = useState(false);
  const [errors, setErrors] = useState({});

  const [formData, setFormData] = useState({
    clientName: client?.clientName || "",
    state: client?.state || "",
    invoicingCompany: client?.invoicingCompany || "",
    status: client?.status === "INACTIVE" ? "Inactive" : "Active",
    invoiceSubject: client?.invoiceSubject || "",
    invoiceTemplate: client?.invoiceTemplate || "",
  });

  const handleInputChange = (field, value) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  const handleSave = async () => {
    try {
      setSubmitting(true);
      setErrors({});

      // Build request payload from formData
      const payload = {
        ...formData,
        status: formData.status === "Active" ? "ACTIVE" : "INACTIVE",
      };

      if (client) {
        // Update existing client
        await clientApi.update(client.id, payload);
        toast.success("Client updated successfully");
      } else {
        // Create new client
        await clientApi.create(payload);
        toast.success("Client created successfully");
      }

      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      const apiErrors = err.response?.data?.errors;
      if (apiErrors) {
        setErrors(apiErrors);
      }
      toast.error(
        err.response?.data?.message ||
          `Failed to ${client ? "update" : "create"} client`,
      );
    } finally {
      setSubmitting(false);
    }
  };



  return (
    <Modal onClose={onClose} label="Client details">
      <div
        className="modal-surface bg-[hsl(var(--color-card))] rounded-lg w-full max-w-4xl my-4 flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-3 sm:px-6 py-3 sm:py-4 border-b border-[hsl(var(--color-border))] gap-2 flex-wrap bg-[hsl(var(--color-surface-elevated))] rounded-t-lg"
        >
          <div className="flex items-center gap-2">
            <Building2 className="w-4 h-4 sm:w-5 sm:h-5 text-[hsl(var(--color-foreground-secondary))]" />
            <h2 className="text-base sm:text-lg font-semibold text-[hsl(var(--color-foreground))]">
              {client ? "Edit Client" : "Client Details"}
            </h2>
          </div>

          <button type="button" onClick={onClose} aria-label="Close client form" className="icon-button">
            <X size={20} />
          </button>
        </div>

        {/* Content */}
        <div className="overflow-y-auto p-6">
          {/* Client Details Section */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                Client Name *
              </label>
              <Input
                value={formData.clientName}
                onChange={(e) =>
                  handleInputChange("clientName", e.target.value)
                }
                placeholder="Enter client name"
              />
              {errors.clientName && (
                <p className="text-xs text-[hsl(var(--color-error))] mt-1">{errors.clientName}</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                State
              </label>
              <StateInput
                value={formData.state}
                onChange={(next) => handleInputChange("state", next)}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                Invoicing Company
              </label>
              <Input
                value={formData.invoicingCompany}
                onChange={(e) =>
                  handleInputChange("invoicingCompany", e.target.value)
                }
                placeholder="Enter invoicing company"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                Status
              </label>
              <Select
                value={formData.status}
                onChange={(e) => handleInputChange("status", e.target.value)}
              >
                <option value="Active">Active</option>
                <option value="Inactive">Inactive</option>
              </Select>
            </div>

            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                Invoice Subject
              </label>
              <Input
                value={formData.invoiceSubject}
                onChange={(e) =>
                  handleInputChange("invoiceSubject", e.target.value)
                }
                placeholder="Enter invoice subject"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-1">
                Invoice Template
              </label>
              <Select
                value={formData.invoiceTemplate}
                onChange={(e) =>
                  handleInputChange("invoiceTemplate", e.target.value)
                }
              >
                <option value="">Select Template</option>
                <option value="Standard Template">Standard Template</option>
                <option value="Retail Template">Retail Template</option>
                <option value="IT Template">IT Template</option>
              </Select>
            </div>
          </div>
        </div>
        <div className="modal-footer flex items-center justify-end gap-3 px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSave} disabled={submitting}>
            <Save size={16} />
            {submitting ? "Saving..." : "Save client"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
