export default function Brand({ compact = false }) {
  return <div className={`brand ${compact ? "brand-compact" : ""}`} aria-label="Tapvera Scheduler">
    <span className="brand-word">{compact ? "t" : "tapvera"}<span className="brand-dot">.</span></span>
    {!compact && <span className="brand-caption">SCHEDULER</span>}
  </div>;
}
