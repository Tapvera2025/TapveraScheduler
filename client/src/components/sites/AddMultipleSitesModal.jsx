import Modal from "../ui/Modal";
import ResponsiveTable from "../ui/ResponsiveTable";
import { useState, useEffect } from "react";
import { X, Plus, Trash2 } from "lucide-react";
import toast from "react-hot-toast";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Select } from "../ui/Select";
import { siteApi, clientApi } from "../../lib/api";

export default function AddMultipleSitesModal({ onClose, onSuccess }) {
  const [submitting, setSubmitting] = useState(false);
  const [clients, setClients] = useState([]);

  const [sites, setSites] = useState([
    {
      id: 1,
      siteName: "",
      shortName: "",
      address: "",
      client: "",
      checked: false,
    },
    {
      id: 2,
      siteName: "",
      shortName: "",
      address: "",
      client: "",
      checked: false,
    },
    {
      id: 3,
      siteName: "",
      shortName: "",
      address: "",
      client: "",
      checked: false,
    },
    {
      id: 4,
      siteName: "",
      shortName: "",
      address: "",
      client: "",
      checked: false,
    },
    {
      id: 5,
      siteName: "",
      shortName: "",
      address: "",
      client: "",
      checked: false,
    },
    {
      id: 6,
      siteName: "",
      shortName: "",
      address: "",
      client: "",
      checked: false,
    },
  ]);

  // Fetch clients on mount
  useEffect(() => {
    const fetchClients = async () => {
      try {
        const response = await clientApi.getAll({ limit: 100 });
        const clientsData =
          response.data.data?.clients || response.data.data || response.data;

        if (Array.isArray(clientsData) && clientsData.length > 0) {
          setClients(clientsData);
        }
      } catch (err) {
        console.warn("Failed to fetch clients, using static data:", err);
        // Keep static clients as fallback
      }
    };

    fetchClients();
  }, []);



  const handleAddMoreSites = () => {
    const newId = Math.max(...sites.map((s) => s.id)) + 1;
    setSites([
      ...sites,
      {
        id: newId,
        siteName: "",
        shortName: "",
        address: "",
        client: "",
        checked: false,
      },
    ]);
  };

  const handleDeleteSite = (id) => {
    setSites(sites.filter((site) => site.id !== id));
  };

  const handleSiteChange = (id, field, value) => {
    setSites(
      sites.map((site) =>
        site.id === id ? { ...site, [field]: value } : site,
      ),
    );
  };

  const handleCheckboxChange = (id) => {
    setSites(
      sites.map((site) =>
        site.id === id ? { ...site, checked: !site.checked } : site,
      ),
    );
  };

  const handleSave = async () => {
    try {
      setSubmitting(true);

      // Filter out empty sites (sites with at least siteName and shortName filled)
      const validSites = sites.filter(
        (s) => s.siteName.trim() && s.shortName.trim(),
      );

      if (validSites.length === 0) {
        toast.error(
          "Please fill in at least one site with Name and Short Name",
        );
        return;
      }

      // Map to API format
      const payload = validSites.map((site) => ({
        siteLocationName: site.siteName,
        shortName: site.shortName,
        address: site.address,
        client: site.client || "No Client",
        status: "ACTIVE",
      }));

      const response = await siteApi.bulkCreate(payload);

      onClose();
      if (onSuccess) onSuccess();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to create sites");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal onClose={onClose} label="Add multiple sites">
      <div
        className="modal-surface modal-responsive w-full max-w-6xl"
      >
        {/* Header */}
        <div
          className="modal-header flex items-center justify-between px-6 py-4 border-b border-[hsl(var(--color-border))] bg-[hsl(var(--color-surface-elevated))] rounded-t-lg"
        >
          <h2 className="text-lg font-semibold text-[hsl(var(--color-foreground))]">
            Add Sites
          </h2>
          <button type="button" aria-label="Close dialog"
            onClick={onClose}
            className="p-1 hover:bg-[hsl(var(--color-border))] rounded transition-colors"
          >
            <X className="w-5 h-5 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
        </div>

        {/* Content */}
        <div className="p-6 max-h-[70vh] overflow-y-auto">
          <div className="overflow-x-auto">
            <ResponsiveTable className="w-full">
              <thead role="rowgroup">
                <tr role="row" className="border-b border-[hsl(var(--color-border))]">
                  <th role="columnheader" scope="col" className="w-10 pb-3"></th>
                  <th role="columnheader" scope="col" className="text-left pb-3 px-2 text-sm font-medium text-[hsl(var(--color-foreground-secondary))]">
                    Site Name
                  </th>
                  <th role="columnheader" scope="col" className="text-left pb-3 px-2 text-sm font-medium text-[hsl(var(--color-foreground-secondary))]">
                    Short Name
                  </th>
                  <th role="columnheader" scope="col" className="text-left pb-3 px-2 text-sm font-medium text-[hsl(var(--color-foreground-secondary))]">
                    Address
                  </th>
                  <th role="columnheader" scope="col" className="text-left pb-3 px-2 text-sm font-medium text-[hsl(var(--color-foreground-secondary))]">
                    Client
                  </th>
                  <th role="columnheader" scope="col" className="w-10 pb-3"></th>
                </tr>
              </thead>
              <tbody role="rowgroup">
                {sites.map((site, index) => (
                  <tr role="row"
                    key={site.id}
                    className="border-b border-[hsl(var(--color-border))]"
                  >
                    <td role="cell" data-label="Include site" data-field="select" className="py-3 px-2">
                      <input
                        type="checkbox"
                        checked={site.checked}
                        onChange={() => handleCheckboxChange(site.id)}
                        className="rounded border-[hsl(var(--color-border))] text-[hsl(var(--color-info))] focus:ring-[hsl(var(--color-ring))]"
                      />
                    </td>
                    <td role="cell" data-label="Site name" data-field="wide" className="py-3 px-2">
                      <Input
                        placeholder="Site Name*"
                        value={site.siteName}
                        onChange={(e) =>
                          handleSiteChange(site.id, "siteName", e.target.value)
                        }
                        className={
                          index === sites.length - 1 ? "border-[hsl(var(--color-info))]" : ""
                        }
                      />
                    </td>
                    <td role="cell" data-label="Short name" data-field="wide" className="py-3 px-2">
                      <Input
                        placeholder="Short Name*"
                        value={site.shortName}
                        onChange={(e) =>
                          handleSiteChange(site.id, "shortName", e.target.value)
                        }
                      />
                    </td>
                    <td role="cell" data-label="Address" data-field="wide" className="py-3 px-2">
                      <Input
                        placeholder="Address"
                        value={site.address}
                        onChange={(e) =>
                          handleSiteChange(site.id, "address", e.target.value)
                        }
                      />
                    </td>
                    <td role="cell" data-label="Client" data-field="wide" className="py-3 px-2">
                      <Select
                        value={site.client}
                        onChange={(e) =>
                          handleSiteChange(site.id, "client", e.target.value)
                        }
                      >
                        <option value="">Select...</option>
                        {clients.map((client) => (
                          <option key={client.id} value={client.clientName}>
                            {client.clientName}
                          </option>
                        ))}
                      </Select>
                    </td>
                    <td role="cell" data-label="Actions" data-field="actions" className="py-3 px-2 text-center">
                      <button
                        onClick={() => handleDeleteSite(site.id)}
                        className="p-1.5 text-[hsl(var(--color-info))] hover:bg-[hsl(var(--color-info-soft))] rounded transition-colors"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </ResponsiveTable>
          </div>

          {/* Add More Sites Button */}
          <div className="flex justify-end mt-4">
            <Button
              onClick={handleAddMoreSites}
              className="bg-[hsl(var(--color-primary))] hover:bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))]"
            >
              <Plus className="w-4 h-4 mr-2" />
              Add More Sites
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
            {submitting ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
