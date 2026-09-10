import Badge from "../ui/Badge";

export default function ClientRow({ client, onClientClick }) {
  const handleClick = () => {
    if (onClientClick) {
      onClientClick(client);
    }
  };

  return (
    <tr role="row" className="hover:bg-[hsl(var(--color-surface-elevated))] transition-colors">
      <td role="cell" data-label="Client" data-field="title"
        className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-primary,220_90%_56%))] hover:underline cursor-pointer whitespace-nowrap"
      >
        <button className="record-link" onClick={handleClick}>{client.clientName}</button>
      </td>

      <td role="cell" data-label="State" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
        {client.state}
      </td>

      <td role="cell" data-label="Invoicing company" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
        {client.invoicingCompany}
      </td>

      <td role="cell" data-label="Status" data-field="status" className="px-2 sm:px-3 py-2 sm:py-3">
        <Badge status={client.status} />
      </td>

      <td role="cell" data-label="Invoice subject" data-field="wide" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
        {client.invoiceSubject}
      </td>

      <td role="cell" data-label="Invoice template" data-field="wide" className="px-2 sm:px-3 py-2 sm:py-3 text-[hsl(var(--color-foreground-secondary))] whitespace-nowrap">
        {client.invoiceTemplate}
      </td>
    </tr>
  );
}
