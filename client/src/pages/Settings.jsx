import { useEffect, useState } from "react";
import { Building2, Save, Lock } from "lucide-react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { Input } from "../components/ui/Input";
import { Label } from "../components/ui/Label";
import { Select } from "../components/ui/Select";
import { Badge } from "../components/ui/Badge";
import { companyApi } from "../lib/api";
import { useCompanyStore, DEFAULT_SETTINGS } from "../store/companyStore";
import { DATE_FORMATS, TIME_FORMATS, formatDate, formatTime } from "../lib/format";
import { ORGANISATION_TIMEZONES } from "../constants/locations";
import { MODULE_LABELS } from "../constants/modules";
import { toast } from "react-hot-toast";

export default function Settings() {
  const setOrganisation = useCompanyStore((state) => state.setOrganisation);

  const [company, setCompany] = useState(null);
  const [form, setForm] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await companyApi.getMine();
        const data = res.data.data;
        setCompany(data);
        setForm({
          name: data.name || "",
          legalName: data.legalName || "",
          businessNumber: data.businessNumber || "",
          email: data.email || "",
          phone: data.phone || "",
          timezone: data.timezone || "Australia/Sydney",
          settings: { ...DEFAULT_SETTINGS, ...(data.settings || {}) },
        });
      } catch (err) {
        toast.error(err.response?.data?.message || "Could not load your settings");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const setField = (field, value) => setForm((prev) => ({ ...prev, [field]: value }));
  const setSetting = (field, value) =>
    setForm((prev) => ({ ...prev, settings: { ...prev.settings, [field]: value } }));

  const save = async () => {
    if (!form.name.trim()) {
      toast.error("Your organisation needs a name");
      return;
    }

    try {
      setSaving(true);
      const res = await companyApi.updateMine(form);
      const data = res.data.data;
      setCompany(data);
      // Apply the new formats everywhere straight away
      setOrganisation(data);
      toast.success("Settings saved");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save your settings");
    } finally {
      setSaving(false);
    }
  };

  if (loading || !form) {
    return (
      <div className="p-8 text-[hsl(var(--color-foreground-secondary))]">Loading...</div>
    );
  }

  const sample = new Date();

  return (
    <div className="settings-page settings-content max-w-3xl">
      <div className="settings-heading">
        <div className="bg-[hsl(var(--color-info-soft))]/30 p-3 rounded-xl">
          <Building2 className="w-6 h-6 text-[hsl(var(--color-info))]" />
        </div>
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold text-[hsl(var(--color-foreground))]">
            Organisation settings
          </h1>
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5">
            How your organisation is named and how dates and times are shown.
          </p>
        </div>
      </div>

      {/* Details */}
      <Card className="platform-card p-6 mb-6">
        <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))] mb-4">
          Details
        </h2>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label htmlFor="name">Organisation name *</Label>
            <Input
              id="name"
              value={form.name}
              onChange={(e) => setField("name", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="legalName">Legal name</Label>
            <Input
              id="legalName"
              value={form.legalName}
              onChange={(e) => setField("legalName", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="businessNumber">Business number (ABN)</Label>
            <Input
              id="businessNumber"
              value={form.businessNumber}
              onChange={(e) => setField("businessNumber", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              value={form.email}
              onChange={(e) => setField("email", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label htmlFor="phone">Phone</Label>
            <Input
              id="phone"
              value={form.phone}
              onChange={(e) => setField("phone", e.target.value)}
              className="mt-1.5"
            />
          </div>
        </div>
      </Card>

      {/* Regional */}
      <Card className="platform-card p-6 mb-6">
        <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))] mb-1">
          Dates, times and currency
        </h2>
        <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mb-4">
          These apply across every screen for everyone in your organisation.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label htmlFor="timezone">Timezone</Label>
            <Select
              id="timezone"
              value={form.timezone}
              onChange={(e) => setField("timezone", e.target.value)}
              className="mt-1.5"
            >
              {ORGANISATION_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="dateFormat">Date format</Label>
            <Select
              id="dateFormat"
              value={form.settings.dateFormat}
              onChange={(e) => setSetting("dateFormat", e.target.value)}
              className="mt-1.5"
            >
              {DATE_FORMATS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="timeFormat">Time format</Label>
            <Select
              id="timeFormat"
              value={form.settings.timeFormat}
              onChange={(e) => setSetting("timeFormat", e.target.value)}
              className="mt-1.5"
            >
              {TIME_FORMATS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="currency">Currency</Label>
            <Select
              id="currency"
              value={form.settings.currency}
              onChange={(e) => setSetting("currency", e.target.value)}
              className="mt-1.5"
            >
              <option value="AUD">AUD</option>
              <option value="NZD">NZD</option>
              <option value="USD">USD</option>
              <option value="GBP">GBP</option>
            </Select>
          </div>
          <div className="sm:col-span-2 p-3 rounded-xl bg-[hsl(var(--color-surface-elevated))] border border-[hsl(var(--color-border))]">
            <p className="text-xs text-[hsl(var(--color-foreground-secondary))]">
              Currently saved:{" "}
              <span className="text-[hsl(var(--color-foreground))] font-medium">
                {formatDate(sample)} · {formatTime(sample)}
              </span>
              . Save to apply your changes.
            </p>
          </div>
        </div>
      </Card>

      {/* Managed by the platform */}
      <Card className="p-6 mb-6">
        <div className="flex items-center gap-2 mb-1">
          <Lock className="w-4 h-4 text-[hsl(var(--color-foreground-muted))]" />
          <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))]">
            Your plan
          </h2>
        </div>
        <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mb-4">
          Set for you when your account was created. Get in touch to change it.
        </p>

        <div className="space-y-3">
          <div>
            <p className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1.5">
              Subscription
            </p>
            <div className="flex items-center gap-2">
              <Badge variant="info">{company?.subscription?.plan || "trial"}</Badge>
              <Badge
                variant={company?.subscription?.status === "active" ? "success" : "warning"}
              >
                {company?.subscription?.status || "active"}
              </Badge>
            </div>
          </div>
          <div>
            <p className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-1.5">
              Modules you have access to
            </p>
            <div className="flex flex-wrap gap-1.5">
              {(company?.enabledModules || []).length === 0 ? (
                <span className="text-sm text-[hsl(var(--color-foreground-secondary))]">
                  All modules
                </span>
              ) : (
                company.enabledModules.map((key) => (
                  <Badge key={key} variant="outline">
                    {MODULE_LABELS[key] || key}
                  </Badge>
                ))
              )}
            </div>
          </div>
        </div>
      </Card>

      <Button onClick={save} disabled={saving}>
        <Save className="w-4 h-4" />
        {saving ? "Saving..." : "Save settings"}
      </Button>
    </div>
  );
}
