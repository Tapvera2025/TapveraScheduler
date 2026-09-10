import { Ban, CheckCircle2, ClipboardList, Clock3, XCircle } from "lucide-react";
import { createElement } from "react";

export default function LeaveStats({ stats }) {
  const statCards = [
    { label: "All requests", value: stats?.total || 0, detail: "Across your team", icon: ClipboardList, tone: "primary" },
    { label: "Awaiting", value: stats?.awaiting ?? stats?.pending ?? 0, detail: "Need a decision", icon: Clock3, tone: "warning" },
    { label: "Approved", value: stats?.approved || 0, detail: "Confirmed time away", icon: CheckCircle2, tone: "success" },
    { label: "Declined", value: stats?.declined || 0, detail: "Not approved", icon: XCircle, tone: "error" },
    { label: "Cancelled", value: stats?.cancelled || 0, detail: "No longer active", icon: Ban, tone: "neutral" },
  ];

  return (
    <section className="leave-summary-grid" aria-label="Leave request summary">
      {statCards.map(({ label, value, detail, icon: Icon, tone }) => (
        <article className={`stat-card leave-stat-${tone}`} key={label}>
          <div className="stat-card-top"><span>{label}</span>{createElement(Icon, { size: 18, strokeWidth: 1.5 })}</div>
          <div className="stat-value">{String(value).padStart(2, "0")}</div>
          <div className="stat-card-bottom"><span>{detail}</span></div>
        </article>
      ))}
    </section>
  );
}
