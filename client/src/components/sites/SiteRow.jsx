import Badge from "../ui/Badge";
import { MapPin, Pencil } from "lucide-react";

export default function SiteRow({ site, onSiteClick, onMapClick }) {
  const handleClick = () => {
    if (onSiteClick) {
      onSiteClick(site);
    }
  };

  const handleMapClick = (e) => {
    e.stopPropagation();
    if (onMapClick) {
      onMapClick(site);
    }
  };

  return (
    <tr role="row" className="hover:bg-[hsl(var(--color-surface-elevated))] transition-colors">
      <td role="cell" data-label="Site" data-field="title"
        className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-primary))] hover:underline cursor-pointer whitespace-nowrap"
      >
        <button className="record-link" onClick={handleClick}>{site.siteLocationName}</button>
      </td>
      <td role="cell" data-label="Short name" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground))] whitespace-nowrap">
        {site.shortName}
      </td>
      <td role="cell" data-label="Client" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground))] whitespace-nowrap">
        {site.client}
      </td>
      <td role="cell" data-label="State" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground))] whitespace-nowrap">
        {site.state}
      </td>
      <td role="cell" data-label="Status" data-field="status" className="px-2 sm:px-3 py-2 sm:py-3">
        <Badge status={site.status} />
      </td>
      <td role="cell" data-label="Expiring in 30 days" className="px-2 sm:px-3 py-2 sm:py-3 text-center text-[hsl(var(--color-foreground))]">
        {site.expiryIn30Days ?? 0}
      </td>
      <td role="cell" data-label="Map" data-field="actions" className="px-2 sm:px-3 py-2 sm:py-3 text-center">
        <button
          onClick={handleMapClick}
          className="text-[hsl(var(--color-primary))] hover:text-[hsl(var(--color-primary))] transition-colors"
          title="View on Map"
        >
          <MapPin className="w-4 h-4 sm:w-5 sm:h-5 mx-auto" /><span className="mobile-action-label">View map</span>
        </button>
      </td>
      <td role="cell" data-label="Actions" data-field="actions" className="px-2 sm:px-3 py-2 sm:py-3 text-right sticky right-0 bg-[hsl(var(--color-card))] hover:bg-[hsl(var(--color-surface-elevated))] z-[5] relative">
        <button onClick={handleClick} className="px-2 sm:px-3 py-1.5 bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded text-xs sm:text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors flex items-center gap-1">
          <Pencil className="w-3 h-3" /> Edit site
        </button>
      </td>
    </tr>
  );
}
