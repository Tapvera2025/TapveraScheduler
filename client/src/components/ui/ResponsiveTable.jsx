import { cn } from "../../lib/utils";

/** Cells provide data-label explicitly so the mobile reading order stays clear. */
export default function ResponsiveTable({ className, children, ...props }) {
  return <table role="table" className={cn("responsive-table w-full", className)} {...props}>{children}</table>;
}

export function MobileTableSort({ columns, sortConfig, onSort }) {
  return <div className="mobile-table-sort">
    <label>
      <span>Sort by</span>
      <select value={sortConfig.key || ""} onChange={(event) => onSort(event.target.value)}>
        {columns.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
      </select>
    </label>
    <button type="button" onClick={() => onSort(sortConfig.key)} aria-label={`Sort ${sortConfig.direction === "asc" ? "descending" : "ascending"}`}>
      {sortConfig.direction === "asc" ? "↑ Ascending" : "↓ Descending"}
    </button>
  </div>;
}
