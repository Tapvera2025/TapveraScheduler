import Pagination from "../ui/Pagination";
import ResponsiveTable from "../ui/ResponsiveTable";
import SortableHeader from "../ui/SortableHeader";
import { useTableSort } from "../../hooks/useTableSort";
import { MobileTableSort } from "../ui/ResponsiveTable";
import ClientRow from "./ClientRow";

export default function ClientsTable({
  clients = [],
  loading = false,
  pagination,
  onPageChange,
  onClientClick,
}) {
  const { sortedData, sortConfig, requestSort, getSortIndicator } = useTableSort(clients, { defaultColumn: "clientName" });
  return (
    <div className="bg-[hsl(var(--color-card))] border border-[hsl(var(--color-border))] rounded-lg sm:rounded-xl shadow-sm">
      <MobileTableSort columns={[["clientName", "Client name"], ["state", "State"], ["status", "Status"]]} sortConfig={sortConfig} onSort={requestSort} />
      <div className="overflow-x-auto overflow-y-visible">
        <ResponsiveTable className="w-full text-sm min-w-[900px]">
          <thead role="rowgroup" className="bg-[hsl(var(--color-surface-elevated))] border-b border-[hsl(var(--color-border))]">
            <tr role="row" className="text-[hsl(var(--color-foreground-secondary))] text-xs">
              

              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">
                <SortableHeader label="Client name" sortKey="clientName" onSort={requestSort} sortDirection={getSortIndicator("clientName")} />
              </th>

              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left whitespace-nowrap">
                State
              </th>

              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left whitespace-nowrap">
                Invoicing Company
              </th>

              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left">Status</th>

              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left whitespace-nowrap">
                Invoice Subject
              </th>

              <th role="columnheader" scope="col" className="px-2 sm:px-3 py-2 sm:py-3 text-left whitespace-nowrap">
                Invoice Template
              </th>
            </tr>
          </thead>

          <tbody role="rowgroup" className="divide-y divide-[hsl(var(--color-border))]">
            {loading ? (
              <tr role="row">
                <td role="cell"
                  colSpan="6"
                  className="px-4 py-8 text-center text-[hsl(var(--color-foreground-muted))]"
                >
                  Loading clients...
                </td>
              </tr>
            ) : clients.length === 0 ? (
              <tr role="row">
                <td role="cell"
                  colSpan="6"
                  className="px-4 py-8 text-center text-[hsl(var(--color-foreground-muted))]"
                >
                  No clients found
                </td>
              </tr>
            ) : (
              sortedData.map((client) => (
                <ClientRow
                  key={client.id}
                  client={client}
                  onClientClick={onClientClick}
                />
              ))
            )}
          </tbody>
        </ResponsiveTable>
      </div>

      <Pagination page={pagination?.page || 1} limit={pagination?.limit || 25} total={pagination?.total ?? clients.length} totalPages={pagination?.pages || pagination?.totalPages || 1} onPageChange={onPageChange} loading={loading} noun="clients" />
    </div>
  );
}
