import Modal from "../ui/Modal";
import { useState } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { clientApi } from "../../lib/api";

export default function AddMultipleClientsModal({ onClose, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);

  const [clients, setClients] = useState([
    { id: 1, clientName: "", checked: false },
    { id: 2, clientName: "", checked: false },
    { id: 3, clientName: "", checked: false },
    { id: 4, clientName: "", checked: false },
    { id: 5, clientName: "", checked: false },
  ]);



  const handleAddMoreClients = () => {
    const newId = Math.max(...clients.map((c) => c.id)) + 1;
    setClients([
      ...clients,
      { id: newId, clientName: "", checked: false },
    ]);
  };

  const handleDeleteClient = (id) => {
    setClients(clients.filter((client) => client.id !== id));
  };

  const handleClientChange = (id, field, value) => {
    setClients(
      clients.map((client) =>
        client.id === id ? { ...client, [field]: value } : client
      )
    );
  };

  const handleCheckboxChange = (id) => {
    setClients(
      clients.map((client) =>
        client.id === id ? { ...client, checked: !client.checked } : client
      )
    );
  };

  const handleSave = async () => {
    try {
      setSubmitting(true);

      // Filter out empty clients (clients with at least clientName filled)
      const validClients = clients.filter(c =>
        c.clientName.trim()
      );

      if (validClients.length === 0) {
        toast.error('Please fill in at least one client name');
        return;
      }

      // Map to API format
      const payload = validClients.map(client => ({
        clientName: client.clientName,
        status: 'ACTIVE'
      }));

      await clientApi.bulkCreate(payload);

      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || 'Failed to create clients');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} label="Add multiple clients">
      <div
        className="modal-surface modal-responsive w-full max-w-2xl"
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-[hsl(var(--color-foreground))]">Add Clients</h2>
          <button type="button" aria-label="Close dialog"
            onClick={onClose}
            className="p-1 hover:bg-[hsl(var(--color-surface-elevated))] rounded transition-colors"
          >
            <X className="w-5 h-5 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          <h3 className="text-sm font-medium text-[hsl(var(--color-foreground-secondary))] mb-4">Clients</h3>

          <div className="space-y-3">
            {clients.map((client, index) => (
              <div key={client.id} className="flex items-center gap-3">
                <Input
                  placeholder="Client Name*"
                  value={client.clientName}
                  onChange={(e) =>
                    handleClientChange(client.id, "clientName", e.target.value)
                  }
                  className={`flex-1 ${index === clients.length - 1 ? "border-[hsl(var(--color-info))]" : ""}`}
                />
                <button
                  onClick={() => handleDeleteClient(client.id)}
                  className="p-2 text-[hsl(var(--color-info))] hover:bg-[hsl(var(--color-info-soft))] rounded transition-colors"
                  title="Delete"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))}
          </div>

          {/* Add More Clients Button */}
          <div className="flex justify-end mt-4">
            <Button
              onClick={handleAddMoreClients}
              className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add More Clients
            </Button>
          </div>
        </div>

        {/* Footer */}
        <div className="modal-footer flex items-center justify-end gap-3 px-6 py-4 border-t">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button
            onClick={handleSave}
            disabled={submitting}
            className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {submitting ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
