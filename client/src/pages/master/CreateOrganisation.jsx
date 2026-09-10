import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Building2 } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Label } from "../../components/ui/Label";
import { Select } from "../../components/ui/Select";
import ModulePicker from "../../components/master/ModulePicker";
import CredentialsNotice from "../../components/master/CredentialsNotice";
import { masterApi } from "../../lib/api";
import { ORGANISATION_TIMEZONES } from "../../constants/locations";
import { toast } from "react-hot-toast";

export default function CreateOrganisation() {
  const navigate = useNavigate();

  const [catalogue, setCatalogue] = useState([]);
  const [modules, setModules] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const [form, setForm] = useState({
    name: "",
    legalName: "",
    businessNumber: "",
    email: "",
    phone: "",
    timezone: "Australia/Sydney",
  });

  const [admin, setAdmin] = useState({ name: "", email: "" });

  useEffect(() => {
    const load = async () => {
      try {
        const res = await masterApi.getModules();
        setCatalogue(res.data.data.modules);
        setModules(res.data.data.defaults);
      } catch {
        toast.error("Could not load the module list");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const set = (field) => (e) => setForm((prev) => ({ ...prev, [field]: e.target.value }));
  const setAdminField = (field) => (e) =>
    setAdmin((prev) => ({ ...prev, [field]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();

    if (!form.name.trim() || !form.email.trim()) {
      toast.error("An organisation needs a name and an email address");
      return;
    }

    try {
      setSaving(true);
      const res = await masterApi.createOrganisation({
        ...form,
        enabledModules: modules,
        ...(admin.email.trim() ? { admin: { name: admin.name, email: admin.email } } : {}),
      });

      const { organisation, admin: createdAdmin } = res.data.data;
      toast.success(`${organisation.name} created`);

      // The first admin's password is shown once and never again.
      if (createdAdmin) {
        setCredentials(createdAdmin);
      } else {
        navigate(`/master/organisations/${organisation.id}`);
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not create the organisation");
    } finally {
      setSaving(false);
    }
  };

  if (credentials) {
    return (
      <div className="platform-detail-page">
        <CredentialsNotice
          result={credentials}
          onDismiss={() => navigate("/master/organisations")}
        />
      </div>
    );
  }

  return (
    <div className="platform-detail-page">
      <Link to="/master/organisations" className="solid-link mb-4 inline-flex">
        <ArrowLeft size={16} />
        Back to the list
      </Link>

      <PageHeader
        icon={Building2}
        eyebrow="PLATFORM"
        title="New organisation"
        description="Create the organisation, choose its modules, and optionally add its first admin."
      />

      <form onSubmit={submit} className="platform-content">
        <Card className="platform-card p-6">
          <h2 className="text-base font-semibold mb-4">Organisation</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="name">Name</Label>
              <Input id="name" value={form.name} onChange={set("name")} required />
            </div>
            <div>
              <Label htmlFor="email">Email</Label>
              <Input id="email" type="email" value={form.email} onChange={set("email")} required />
            </div>
            <div>
              <Label htmlFor="legalName">Legal name</Label>
              <Input id="legalName" value={form.legalName} onChange={set("legalName")} />
            </div>
            <div>
              <Label htmlFor="businessNumber">Business number</Label>
              <Input
                id="businessNumber"
                value={form.businessNumber}
                onChange={set("businessNumber")}
              />
            </div>
            <div>
              <Label htmlFor="phone">Phone</Label>
              <Input id="phone" value={form.phone} onChange={set("phone")} />
            </div>
            <div>
              <Label htmlFor="timezone">Timezone</Label>
              <Select id="timezone" value={form.timezone} onChange={set("timezone")}>
                {ORGANISATION_TIMEZONES.map((tz) => (
                  <option key={tz.value || tz} value={tz.value || tz}>
                    {tz.label || tz}
                  </option>
                ))}
              </Select>
            </div>
          </div>
        </Card>

        <Card className="platform-card p-6">
          <h2 className="text-base font-semibold mb-1">Modules</h2>
          <p className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-4">
            Switching one on brings in anything it depends on.
          </p>
          {loading ? (
            <p className="text-sm text-[hsl(var(--color-foreground-muted))]">Loading…</p>
          ) : (
            <ModulePicker catalogue={catalogue} selected={modules} onChange={setModules} />
          )}
        </Card>

        <Card className="platform-card p-6">
          <h2 className="text-base font-semibold mb-1">First admin</h2>
          <p className="text-xs text-[hsl(var(--color-foreground-secondary))] mb-4">
            Optional. Leave blank to add one later from the organisation page.
          </p>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="adminName">Name</Label>
              <Input id="adminName" value={admin.name} onChange={setAdminField("name")} />
            </div>
            <div>
              <Label htmlFor="adminEmail">Email</Label>
              <Input
                id="adminEmail"
                type="email"
                value={admin.email}
                onChange={setAdminField("email")}
              />
            </div>
          </div>
        </Card>

        <div className="flex gap-3">
          <Button type="submit" disabled={saving}>
            {saving ? "Creating…" : "Create organisation"}
          </Button>
          <Link to="/master/organisations">
            <Button type="button" variant="outline">Cancel</Button>
          </Link>
        </div>
      </form>
    </div>
  );
}
