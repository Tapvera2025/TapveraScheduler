import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Building2, CheckCircle2, PauseCircle, UserCog, Users, CalendarDays, LayoutDashboard } from "lucide-react";
import PageHeader from "../../components/layout/PageHeader";
import { Card } from "../../components/ui/Card";
import { Button } from "../../components/ui/Button";
import { masterApi } from "../../lib/api";
import { toast } from "react-hot-toast";

export default function MasterOverview() {
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const res = await masterApi.getStats();
        setStats(res.data.data);
      } catch {
        toast.error("Could not load platform stats");
      } finally {
        setLoading(false);
      }
    };
    load();
  }, []);

  const fmt = (value) => (loading ? "—" : value ?? 0);

  const tiles = [
    { label: "Organisations", value: fmt(stats?.totalOrganisations), icon: Building2, tone: "text-[hsl(var(--color-info))] bg-[hsl(var(--color-info-soft))]/30" },
    { label: "Active", value: fmt(stats?.activeOrganisations), icon: CheckCircle2, tone: "text-[hsl(var(--color-success))] bg-[hsl(var(--color-success-soft))]/30" },
    { label: "Suspended", value: fmt(stats?.suspendedOrganisations), icon: PauseCircle, tone: "text-[hsl(var(--color-error))] bg-[hsl(var(--color-error-soft))]/30" },
    { label: "Admins", value: fmt(stats?.totalAdmins), icon: UserCog, tone: "text-[hsl(var(--color-info))] bg-[hsl(var(--color-info-soft))]/30" },
    { label: "Employees", value: fmt(stats?.totalEmployees), icon: Users, tone: "text-[hsl(var(--color-primary))] bg-[hsl(var(--color-primary-soft))]/30" },
    { label: "Shifts this month", value: fmt(stats?.shiftsThisMonth), icon: CalendarDays, tone: "text-[hsl(var(--color-info))] bg-[hsl(var(--color-info-soft))]/30" },
  ];

  return (
    <div className="platform-page">
      <PageHeader
        icon={LayoutDashboard}
        eyebrow="PLATFORM"
        title="Platform overview"
        description="Every organisation using Tapvera Scheduler."
        actions={
          <Link to="/master/organisations/new">
            <Button>New organisation</Button>
          </Link>
        }
      />

      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-3 sm:gap-4">
        {tiles.map((tile) => {
          const Icon = tile.icon;
          return (
            <Card key={tile.label} className="platform-card platform-stat-card p-4 sm:p-5">
              <div className={`p-2 sm:p-3 rounded-xl self-start inline-flex ${tile.tone}`}>
                <Icon className="w-5 h-5" />
              </div>
              <div className="mt-3">
                <div className="text-2xl font-bold text-[hsl(var(--color-foreground))]">
                  {tile.value}
                </div>
                <div className="text-xs font-medium text-[hsl(var(--color-foreground-secondary))] mt-1">
                  {tile.label}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="platform-card platform-onboarding mt-6 p-6">
        <h2 className="text-lg font-bold text-[hsl(var(--color-foreground))] mb-2">
          Getting started
        </h2>
        <ol className="text-sm text-[hsl(var(--color-foreground-secondary))] space-y-2 list-decimal list-inside">
          <li>Create an organisation and choose which modules it may use.</li>
          <li>Add its first admin — they are emailed their login details automatically.</li>
          <li>The admin signs in and sets up their own employees, clients and sites.</li>
        </ol>
      </Card>
    </div>
  );
}
