import { useEffect, useState, useCallback } from "react";
import { Card } from "../ui/Card";
import { Select } from "../ui/Select";
import { dashboardApi } from "../../lib/api";
import { useSocketEvent } from "../../contexts/SocketContext";

const PERIODS = [
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

function CircularProgress({ percentage, size = 120 }) {
  const capped = Math.max(0, Math.min(percentage || 0, 100));
  const radius = (size - 10) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (capped / 100) * circumference;

  // Under-coverage reads as a problem, at or over target reads as fine
  const stroke =
    percentage >= 95 ? "hsl(var(--color-success))" : percentage >= 75 ? "hsl(var(--color-warning))" : "hsl(var(--color-error))";

  return (
    <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke="hsl(var(--color-border))"
          strokeWidth="8"
          fill="none"
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          stroke={stroke}
          strokeWidth="8"
          fill="none"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
        />
      </svg>
      <div className="absolute inset-0 flex items-center justify-center">
        <span className="text-2xl font-bold text-[hsl(var(--color-foreground))]">
          {percentage ?? 0}%
        </span>
      </div>
    </div>
  );
}

export default function CoverageWidget() {
  const [period, setPeriod] = useState("week");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const res = await dashboardApi.getCoverage(period);
      setData(res.data.data);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [period]);

  useEffect(() => {
    load();
  }, [load]);

  useSocketEvent('clock-in', load);
  useSocketEvent('clock-out', load);
  useSocketEvent('break-end', load); // break end means new hours were worked

  const hrs = (value) => `${(value ?? 0).toFixed(2)} HRS`;
  const signed = (value) => `${value > 0 ? "+" : ""}${(value ?? 0).toFixed(2)}`;
  const signedInt = (value) => `${value > 0 ? "+" : ""}${value ?? 0}`;

  return (
    <Card className="p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-semibold text-[hsl(var(--color-foreground))]">
            Coverage
          </h3>
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))]">
            Planned hours. Real progress.
          </p>
        </div>
        <div className="w-36">
          <Select value={period} onChange={(e) => setPeriod(e.target.value)}>
            {PERIODS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {loading ? (
        <p className="py-10 text-center text-sm text-[hsl(var(--color-foreground-secondary))]">
          Loading...
        </p>
      ) : !data ? (
        <p className="py-10 text-center text-sm text-[hsl(var(--color-foreground-secondary))]">
          Coverage is unavailable right now
        </p>
      ) : data.rostered.shifts === 0 ? (
        <p className="py-10 text-center text-sm text-[hsl(var(--color-foreground-secondary))]">
          Nothing rostered for this period
        </p>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row items-center sm:items-start gap-6">
            <CircularProgress percentage={data.hoursPercentage} />
            <div className="flex-1 min-w-0 w-full">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-xs text-[hsl(var(--color-foreground-muted))]">
                    <th />
                    <th className="text-right font-medium pb-1">Hours</th>
                    <th className="text-right font-medium pb-1">Shifts</th>
                  </tr>
                </thead>
                <tbody>
                  <tr className="border-b border-[hsl(var(--color-border))]">
                    <td className="py-2 text-[hsl(var(--color-foreground-secondary))]">
                      Rostered
                    </td>
                    <td className="py-2 text-right font-medium text-[hsl(var(--color-foreground))]">
                      {hrs(data.rostered.hours)}
                    </td>
                    <td className="py-2 text-right font-medium text-[hsl(var(--color-foreground))]">
                      {data.rostered.shifts}
                    </td>
                  </tr>
                  <tr className="border-b border-[hsl(var(--color-border))]">
                    <td className="py-2 text-[hsl(var(--color-foreground-secondary))]">
                      Actual
                    </td>
                    <td className="py-2 text-right font-medium text-[hsl(var(--color-foreground))]">
                      {hrs(data.actual.hours)}
                    </td>
                    <td className="py-2 text-right font-medium text-[hsl(var(--color-foreground))]">
                      {data.actual.records}
                    </td>
                  </tr>
                  <tr>
                    <td className="py-2 font-semibold text-[hsl(var(--color-foreground-secondary))]">
                      Difference
                    </td>
                    <td
                      className={`py-2 text-right font-semibold ${
                        data.difference.hours < 0
                          ? "text-[hsl(var(--color-error))]"
                          : "text-[hsl(var(--color-success))]"
                      }`}
                    >
                      {signed(data.difference.hours)}
                    </td>
                    <td className="py-2 text-right font-semibold text-[hsl(var(--color-foreground))]">
                      {signedInt(data.difference.shifts)}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-4">
            {data.shiftsPercentage}% of rostered shifts were attended.
          </p>
        </>
      )}
    </Card>
  );
}
