import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, Search, Users, UserCog, ArrowUpRight } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { Input } from "../../components/ui/Input";
import { Badge } from "../../components/ui/Badge";
import { masterApi } from "../../lib/api";
import { toast } from "react-hot-toast";

export default function Organisations() {
  const [organisations, setOrganisations] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, limit: 25, total: 0, pages: 1 });
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await masterApi.listOrganisations({
        page: pagination.page,
        limit: pagination.limit,
        ...(search ? { search } : {}),
      });
      const data = res.data.data;
      setOrganisations(data.organisations || []);
      setPagination((prev) => ({ ...prev, ...(data.pagination || {}) }));
    } catch (err) {
      toast.error(err.response?.data?.message || "Could not load organisations");
    } finally {
      setLoading(false);
    }
  }, [pagination.page, pagination.limit, search]);

  useEffect(() => {
    const timer = setTimeout(load, search ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, search]);

  const status = (org) => {
    if (!org.isActive) return { label: "Deactivated", tone: "muted" };
    const sub = org.subscription?.status;
    if (sub === "suspended" || sub === "cancelled") return { label: "Suspended", tone: "warning" };
    return { label: "Active", tone: "success" };
  };

  return (
    <div className="platform-page">
      <PageHeader
        icon={Building2}
        eyebrow="PLATFORM"
        title="Organisations"
        description="Every organisation on the platform, and what each one may use."
        actions={
          <Link to="/master/organisations/new">
            <Button>New organisation</Button>
          </Link>
        }
      />

      <div className="platform-toolbar">
        <div className="relative flex-1 max-w-sm">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-[hsl(var(--color-foreground-muted))]" />
          <Input
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPagination((prev) => ({ ...prev, page: 1 }));
            }}
            placeholder="Search by name or email"
            className="pl-9"
          />
        </div>
        <span className="text-xs text-[hsl(var(--color-foreground-muted))]">
          {loading ? "Loading…" : `${pagination.total} total`}
        </span>
      </div>

      {!loading && organisations.length === 0 && (
        <Card className="platform-card p-12 text-center">
          <Building2 className="w-12 h-12 text-[hsl(var(--color-foreground-muted))] mx-auto mb-3" />
          <h3 className="text-base font-semibold text-[hsl(var(--color-foreground))] mb-1">
            {search ? "Nothing matches that search" : "No organisations yet"}
          </h3>
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))]">
            {search ? "Try a different name or email." : "Create the first one to get started."}
          </p>
        </Card>
      )}

      {organisations.length > 0 && (
        <Card className="platform-card overflow-hidden">
          {organisations.map((org) => {
            const state = status(org);
            return (
              <Link
                key={org.id}
                to={`/master/organisations/${org.id}`}
                className="flex items-center justify-between gap-4 px-4 py-3 border-b border-[hsl(var(--color-border))] last:border-0 hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-[hsl(var(--color-foreground))] truncate">{org.name}</p>
                  <p className="text-xs text-[hsl(var(--color-foreground-muted))] truncate">{org.email}</p>
                </div>

                <div className="hidden sm:flex items-center gap-4 text-xs text-[hsl(var(--color-foreground-muted))]">
                  <span title="Admins" className="inline-flex items-center gap-1"><UserCog className="w-3.5 h-3.5" />{org.adminCount}</span>
                  <span title="Employees" className="inline-flex items-center gap-1"><Users className="w-3.5 h-3.5" />{org.employeeCount}</span>
                  <span title="Modules enabled">{org.enabledModules?.length || 0} modules</span>
                </div>

                <div className="flex items-center gap-3 flex-shrink-0">
                  <Badge variant={state.tone}>{state.label}</Badge>
                  <ArrowUpRight className="w-4 h-4 text-[hsl(var(--color-foreground-muted))]" />
                </div>
              </Link>
            );
          })}
        </Card>
      )}

      {pagination.pages > 1 && (
        <div className="flex items-center justify-between mt-4">
          <span className="text-xs text-[hsl(var(--color-foreground-secondary))]">
            Page {pagination.page} of {pagination.pages}
          </span>
          <div className="flex gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page <= 1 || loading}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page - 1 }))}
            >
              Previous
            </Button>
            <Button
              variant="outline"
              size="sm"
              disabled={pagination.page >= pagination.pages || loading}
              onClick={() => setPagination((prev) => ({ ...prev, page: prev.page + 1 }))}
            >
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
