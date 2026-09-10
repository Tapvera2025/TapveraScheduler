import { Button } from "./Button";

export default function Pagination({ page = 1, limit = 25, total = 0, totalPages = 1, onPageChange, loading = false, noun = "records" }) {
  const pages = Math.max(1, totalPages);
  return <nav className="data-pagination" aria-label={`${noun} pagination`}>
    <p aria-live="polite">{total ? `${(page - 1) * limit + 1}–${Math.min(page * limit, total)} of ${total}` : "0"} {noun}</p>
    {pages > 1 && <div>
      <Button variant="outline" size="sm" disabled={loading || page <= 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
      <span>{page} / {pages}</span>
      <Button variant="outline" size="sm" disabled={loading || page >= pages} onClick={() => onPageChange(page + 1)}>Next</Button>
    </div>}
  </nav>;
}
