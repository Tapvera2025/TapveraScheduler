import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Mail, RotateCw, UserPlus, Users, MapPin, CalendarDays } from "lucide-react";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Label } from "../../components/ui/Label";
import { Select } from "../../components/ui/Select";
import { Badge } from "../../components/ui/Badge";
import { Switch } from "../../components/ui/Switch";
import ModulePicker from "../../components/master/ModulePicker";
import CredentialsNotice from "../../components/master/CredentialsNotice";
import { masterApi } from "../../lib/api";
import { ORGANISATION_TIMEZONES } from "../../constants/locations";
import { toast } from "react-hot-toast";

const sameList = (a, b) =>
  a.length === b.length && a.every((value, index) => value === b[index]);

export default function OrganisationDetail() {
  const { id } = useParams();

  const [org, setOrg] = useState(null);
  const [catalogue, setCatalogue] = useState([]);
  const [loading, setLoading] = useState(true);

  const [modules, setModules] = useState([]);
  const [savingModules, setSavingModules] = useState(false);

  const [details, setDetails] = useState(null);
  const [savingDetails, setSavingDetails] = useState(false);

  const [newAdmin, setNewAdmin] = useState({ name: "", email: "", role: "ADMIN" });
  const [addingAdmin, setAddingAdmin] = useState(false);
  const [credentials, setCredentials] = useState(null);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const [orgRes, moduleRes] = await Promise.all([
        masterApi.getOrganisation(id),
        masterApi.getModules(),
      ]);
      const data = orgRes.data.data;
      setOrg(data);
      setModules(data.enabledModules);
      setCatalogue(moduleRes.data.data.modules);
      setDetails({
        name: data.name || "",
        legalName: data.legalName || "",
        businessNumber: data.businessNumber || "",
        email: data.email || "",
        phone: data.phone || "",
        timezone: data.timezone || "Australia/Sydney",
        primaryContact: {
          name: data.primaryContact?.name || "",
          email: data.primaryContact?.email || "",
          phone: data.primaryContact?.phone || "",
        },
      });
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load the organisation");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);

  const saveModules = async () => {
    try {
      setSavingModules(true);
      const res = await masterApi.setModules(id, modules);
      const { organisation, addedForDependencies } = res.data.data;
      setOrg(organisation);
      setModules(organisation.enabledModules);

      if (addedForDependencies.length > 0) {
        toast.success(
          `Saved. Also enabled ${addedForDependencies.join(", ")} because other modules need them.`
        );
      } else {
        toast.success("Module access updated");
      }
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update modules");
    } finally {
      setSavingModules(false);
    }
  };

  const saveDetails = async () => {
    try {
      setSavingDetails(true);
      const res = await masterApi.updateOrganisation(id, details);
      setOrg(res.data.data);
      toast.success("Details saved");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not save the details");
    } finally {
      setSavingDetails(false);
    }
  };

  const changeStatus = async (payload) => {
    try {
      const res = await masterApi.setStatus(id, payload);
      setOrg(res.data.data);
      toast.success("Status updated");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not update the status");
    }
  };

  const addAdmin = async () => {
    if (!newAdmin.name.trim() || !/\S+@\S+\.\S+/.test(newAdmin.email)) {
      toast.error("An admin needs a name and a valid email");
      return;
    }

    try {
      setAddingAdmin(true);
      const res = await masterApi.createAdmin(id, newAdmin);
      setCredentials(res.data.data);
      setNewAdmin({ name: "", email: "", role: "ADMIN" });
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not create the admin");
    } finally {
      setAddingAdmin(false);
    }
  };

  const resend = async (userId) => {
    try {
      const res = await masterApi.resendCredentials(id, userId);
      setCredentials(res.data.data);
      toast.success("A new password has been issued");
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not reissue credentials");
    }
  };

  if (loading || !org || !details) {
    return (
      <div className="p-8 text-[hsl(var(--color-foreground-secondary))]">Loading...</div>
    );
  }

  const modulesDirty = !sameList(modules, org.enabledModules);
  const setDetailField = (field, value) =>
    setDetails((prev) => ({ ...prev, [field]: value }));
  const setContactField = (field, value) =>
    setDetails((prev) => ({
      ...prev,
      primaryContact: { ...prev.primaryContact, [field]: value },
    }));

  return (
    <div className="platform-page platform-detail-page">
      <Link
        to="/master/organisations"
        className="inline-flex items-center gap-2 text-sm text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))] mb-4"
      >
        <ArrowLeft className="w-4 h-4" /> Organisations
      </Link>

      <div className="platform-heading">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl sm:text-3xl font-bold text-[hsl(var(--color-foreground))]">
              {org.name}
            </h1>
            {org.isActive ? (
              <Badge variant="success">Active</Badge>
            ) : (
              <Badge variant="error">Deactivated</Badge>
            )}
            {org.subscription?.status && org.subscription.status !== "active" && (
              <Badge variant="warning">{org.subscription.status}</Badge>
            )}
          </div>
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-1">
            {org.email}
          </p>
        </div>
        <Button variant="outline" onClick={load}>
          <RotateCw className="w-4 h-4" /> Refresh
        </Button>
      </div>

      {credentials && (
        <div className="mb-6">
          <CredentialsNotice result={credentials} onDismiss={() => setCredentials(null)} />
        </div>
      )}

      {/* Counts */}
      <div className="grid grid-cols-3 gap-3 sm:gap-4 mb-6">
        {[
          { label: "Employees", value: org.employeeCount, icon: Users },
          { label: "Sites", value: org.siteCount, icon: MapPin },
          { label: "Shifts", value: org.shiftCount, icon: CalendarDays },
        ].map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label} className="platform-card platform-stat-card p-4">
              <Icon className="w-4 h-4 text-[hsl(var(--color-foreground-muted))]" />
              <div className="text-xl font-bold text-[hsl(var(--color-foreground))] mt-2">
                {tile.value}
              </div>
              <div className="text-xs text-[hsl(var(--color-foreground-secondary))]">
                {tile.label}
              </div>
            </Card>
          );
        })}
      </div>

      {/* Modules */}
      <Card className="platform-card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))]">
              Module access
            </h2>
            <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5">
              Changes take effect straight away, even for people already signed in.
            </p>
            {!org.modulesExplicit && (
              <p className="text-xs text-[hsl(var(--color-warning))] mt-1">
                Never set for this organisation — currently behaving as everything on.
                Save to make it explicit.
              </p>
            )}
          </div>
          <Button onClick={saveModules} disabled={!modulesDirty || savingModules}>
            {savingModules ? "Saving..." : "Save"}
          </Button>
        </div>
        <ModulePicker
          catalogue={catalogue}
          selected={modules}
          onChange={setModules}
          disabled={savingModules}
        />
      </Card>

      {/* Admins */}
      <Card className="platform-card p-6 mb-6">
        <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))] mb-1">
          Admins
        </h2>
        <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mb-4">
          These accounts run the organisation day to day.
        </p>

        {org.admins.length === 0 ? (
          <p className="text-sm text-[hsl(var(--color-warning))] mb-4">
            No admins yet — nobody can sign in to this organisation.
          </p>
        ) : (
          <div className="space-y-2 mb-6">
            {org.admins.map((admin) => (
              <div
                key={admin.id}
                className="flex flex-wrap items-center justify-between gap-3 p-3 rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-surface-elevated))]"
              >
                <div className="min-w-0">
                  <p className="font-medium text-[hsl(var(--color-foreground))]">
                    {admin.name}{" "}
                    <span className="text-xs font-normal text-[hsl(var(--color-foreground-secondary))]">
                      {admin.role}
                    </span>
                  </p>
                  <p className="text-sm text-[hsl(var(--color-foreground-secondary))]">
                    {admin.email}
                  </p>
                  <p className="text-xs text-[hsl(var(--color-foreground-muted))]">
                    {admin.lastLoginAt
                      ? `Last signed in ${new Date(admin.lastLoginAt).toLocaleString("en-AU")}`
                      : "Has not signed in yet"}
                  </p>
                </div>
                <Button variant="outline" size="sm" onClick={() => resend(admin.id)}>
                  <Mail className="w-4 h-4" /> Reissue password
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="pt-4 border-t border-[hsl(var(--color-border))]">
          <p className="text-sm font-semibold text-[hsl(var(--color-foreground))] mb-3">
            Add an admin
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input
              value={newAdmin.name}
              onChange={(e) => setNewAdmin((prev) => ({ ...prev, name: e.target.value }))}
              placeholder="Full name"
            />
            <Input
              type="email"
              value={newAdmin.email}
              onChange={(e) => setNewAdmin((prev) => ({ ...prev, email: e.target.value }))}
              placeholder="Email"
            />
            <Select
              value={newAdmin.role}
              onChange={(e) => setNewAdmin((prev) => ({ ...prev, role: e.target.value }))}
            >
              <option value="ADMIN">Admin</option>
              <option value="MANAGER">Manager</option>
            </Select>
          </div>
          <Button className="mt-3" onClick={addAdmin} disabled={addingAdmin}>
            <UserPlus className="w-4 h-4" />
            {addingAdmin ? "Creating..." : "Create and email credentials"}
          </Button>
        </div>
      </Card>

      {/* Details */}
      <Card className="platform-card p-6 mb-6">
        <div className="flex items-start justify-between gap-4 mb-4">
          <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))]">
            Details
          </h2>
          <Button onClick={saveDetails} disabled={savingDetails}>
            {savingDetails ? "Saving..." : "Save"}
          </Button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="sm:col-span-2">
            <Label>Organisation name</Label>
            <Input
              value={details.name}
              onChange={(e) => setDetailField("name", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Legal name</Label>
            <Input
              value={details.legalName}
              onChange={(e) => setDetailField("legalName", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Business number (ABN)</Label>
            <Input
              value={details.businessNumber}
              onChange={(e) => setDetailField("businessNumber", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={details.email}
              onChange={(e) => setDetailField("email", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={details.phone}
              onChange={(e) => setDetailField("phone", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div className="sm:col-span-2">
            <Label>Timezone</Label>
            <Select
              value={details.timezone}
              onChange={(e) => setDetailField("timezone", e.target.value)}
              className="mt-1.5"
            >
              {ORGANISATION_TIMEZONES.map((tz) => (
                <option key={tz.value} value={tz.value}>
                  {tz.label}
                </option>
              ))}
            </Select>
          </div>

          <div className="sm:col-span-2 pt-2 border-t border-[hsl(var(--color-border))]">
            <p className="text-sm font-semibold text-[hsl(var(--color-foreground))] mt-3">
              Primary contact
            </p>
          </div>
          <div>
            <Label>Name</Label>
            <Input
              value={details.primaryContact.name}
              onChange={(e) => setContactField("name", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Email</Label>
            <Input
              type="email"
              value={details.primaryContact.email}
              onChange={(e) => setContactField("email", e.target.value)}
              className="mt-1.5"
            />
          </div>
          <div>
            <Label>Phone</Label>
            <Input
              value={details.primaryContact.phone}
              onChange={(e) => setContactField("phone", e.target.value)}
              className="mt-1.5"
            />
          </div>
        </div>
      </Card>

      {/* Status */}
      <Card className="platform-card p-6">
        <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))] mb-1">
          Access
        </h2>
        <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mb-4">
          Deactivating an organisation blocks every sign-in and every request,
          straight away.
        </p>

        <div className="flex items-center justify-between gap-4 p-4 rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-surface-elevated))]">
          <div>
            <p className="font-medium text-[hsl(var(--color-foreground))]">
              Organisation is active
            </p>
            <p className="text-sm text-[hsl(var(--color-foreground-secondary))]">
              {org.isActive ? "Everyone can sign in." : "Nobody can sign in."}
            </p>
          </div>
          <Switch
            checked={org.isActive}
            onCheckedChange={(next) => changeStatus({ isActive: next })}
          />
        </div>

        <div className="mt-4">
          <Label>Subscription status</Label>
          <Select
            value={org.subscription?.status || "active"}
            onChange={(e) => changeStatus({ subscriptionStatus: e.target.value })}
            className="mt-1.5 sm:max-w-xs"
          >
            <option value="active">Active</option>
            <option value="suspended">Suspended</option>
            <option value="cancelled">Cancelled</option>
          </Select>
          <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1.5">
            Suspended and cancelled organisations are refused at sign-in.
          </p>
        </div>
      </Card>
    </div>
  );
}
