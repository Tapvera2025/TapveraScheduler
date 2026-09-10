import Pagination from "../ui/Pagination";
import ResponsiveTable, { MobileTableSort } from "../ui/ResponsiveTable";
import SiteRow from "./SiteRow";
import SortableHeader from "../ui/SortableHeader";
import { useTableSort } from "../../hooks/useTableSort";

export default function SitesTable({
  sites,
  loading,
  pagination,
  onPageChange,
  onSiteClick,
  onMapClick,
}) {
  const { sortedData, sortConfig, requestSort, getSortIndicator } = useTableSort(sites, {
    defaultColumn: 'siteLocationName',
    defaultDirection: 'asc',
  });
  // If loading, show spinner
  if (loading) {
    return (
      <div className="bg-[hsl(var(--color-card))] rounded-lg sm:rounded-xl shadow-sm p-8 text-center">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-[hsl(var(--color-primary))] mx-auto"></div>
        <p className="mt-4 text-[hsl(var(--color-foreground-secondary))]">
          Loading sites...
        </p>
      </div>
    );
  }

  // If no sites, show empty state
  if (!sites || sites.length === 0) {
    return (
      <div className="bg-[hsl(var(--color-card))] rounded-lg sm:rounded-xl shadow-sm p-8 text-center">
        <p className="text-[hsl(var(--color-foreground-secondary))]">
          No sites found
        </p>
        <p className="text-sm text-[hsl(var(--color-foreground-muted))] mt-2">
          Click "Add New" to create your first site
        </p>
      </div>
    );
  }


  return (
    <div className="bg-[hsl(var(--color-card))] rounded-lg sm:rounded-xl shadow-sm">
      <MobileTableSort columns={[["siteLocationName", "Site name"], ["shortName", "Short name"], ["client", "Client"], ["state", "State"], ["status", "Status"]]} sortConfig={sortConfig} onSort={requestSort} />
      <div className="overflow-x-auto overflow-y-visible">
        <ResponsiveTable className="w-full text-sm min-w-[1000px]">
          <thead role="rowgroup" className="bg-[hsl(var(--color-surface-elevated))] border-b border-[hsl(var(--color-border))]">
            <tr role="row" className="text-[hsl(var(--color-foreground-secondary))] text-xs">
              
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">
                <SortableHeader
                  label="Site/Location Name"
                  sortKey="siteLocationName"
                  onSort={requestSort}
                  sortDirection={getSortIndicator('siteLocationName')}
                />
              </th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">
                <SortableHeader
                  label="Short Name"
                  sortKey="shortName"
                  onSort={requestSort}
                  sortDirection={getSortIndicator('shortName')}
                />
              </th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">
                <SortableHeader
                  label="Client"
                  sortKey="client"
                  onSort={requestSort}
                  sortDirection={getSortIndicator('client')}
                />
              </th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">
                <SortableHeader
                  label="State"
                  sortKey="state"
                  onSort={requestSort}
                  sortDirection={getSortIndicator('state')}
                />
              </th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">
                <SortableHeader
                  label="Status"
                  sortKey="status"
                  onSort={requestSort}
                  sortDirection={getSortIndicator('status')}
                />
              </th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-center whitespace-nowrap">
                Expiry in
                <br />
                30 Days
              </th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-center w-16"></th>
              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-right w-20 sm:w-24 sticky right-0 bg-[hsl(var(--color-surface-elevated))] z-[5]">
                Actions
              </th>
            </tr>
          </thead>

          <tbody role="rowgroup" className="divide-y divide-[hsl(var(--color-border))]">
            {sortedData.map((site, index) => (
              <SiteRow
                key={site.id || site._id || `site-${index}`}
                site={site}
                onSiteClick={onSiteClick}
                onMapClick={onMapClick}
              />
            ))}
          </tbody>
        </ResponsiveTable>
      </div>

      <Pagination page={pagination?.page || 1} limit={pagination?.limit || 25} total={pagination?.total ?? sites.length} totalPages={pagination?.pages || pagination?.totalPages || 1} onPageChange={onPageChange} loading={loading} noun="sites" />
    </div>
  );
}
