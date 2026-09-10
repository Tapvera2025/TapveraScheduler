import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, ArrowUpRight } from "lucide-react";
import { Card } from "../ui/Card";
import { adhocApi } from "../../lib/api";
import { formatDate, formatTime } from "../../lib/format";

/**
 * Pending adhoc shift requests, at a glance.
 *
 * Read-only on purpose: approving a shift belongs on the Adhoc requests screen
 * where the reviewer can see the conflicts, not on a dashboard tile.
 */
export default function AdhocRequestsWidget() {
  const [requests, setRequests] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    adhocApi
      .list({ status: "PENDING", limit: 4 })
      .then((res) => {
        if (!cancelled) setRequests(res.data?.data?.requests || []);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div className="flex items-center gap-2">
          <CalendarPlus className="w-4 h-4 text-[hsl(var(--color-primary))]" />
          <h3 className="text-base font-semibold text-[hsl(var(--color-foreground))]">
            Adhoc requests
          </h3>
        </div>
        <Link
          to="/scheduler/adhoc"
          className="inline-flex items-center gap-1 text-xs font-medium text-[hsl(var(--color-primary))] hover:underline"
        >
          Review
          <ArrowUpRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      {loading && (
        <p className="py-10 text-center text-sm text-[hsl(var(--color-foreground-secondary))]">
          Loading…
        </p>
      )}

      {!loading && requests.length === 0 && (
        <p className="py-10 text-center text-sm text-[hsl(var(--color-foreground-secondary))]">
          No requests waiting on you.
        </p>
      )}

      {!loading && requests.length > 0 && (
        <ul className="divide-y divide-[hsl(var(--color-border))]">
          {requests.map((request) => {
            const employee = request.employeeId;
            const name = employee
              ? `${employee.firstName || ""} ${employee.lastName || ""}`.trim() || "Someone"
              : "Someone";
            return (
              <li key={request.id} className="flex items-center justify-between gap-3 py-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-[hsl(var(--color-foreground))] truncate">
                    {name}
                  </p>
                  <p className="text-xs text-[hsl(var(--color-foreground-muted))] truncate">
                    {request.siteId?.siteLocationName || "No site"}
                  </p>
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-xs text-[hsl(var(--color-foreground-secondary))]">
                    {formatDate(request.startTime || request.date)}
                  </p>
                  <p className="text-xs text-[hsl(var(--color-foreground-muted))]">
                    {formatTime(request.startTime)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
