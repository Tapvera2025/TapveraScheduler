import { Search } from "lucide-react";
import { Input } from "../ui/Input";
import { Switch } from "../ui/Switch";

export default function ClientFilters({ showInactive, setShowInactive, search, onSearchChange }) {
  return <div className="data-toolbar-content">
    <div className="directory-search"><Search size={17} /><Input aria-label="Search clients" placeholder="Search clients…" value={search} onChange={e => onSearchChange(e.target.value)} /></div>
    <label className="directory-toggle"><Switch checked={showInactive} onCheckedChange={setShowInactive} />Include inactive</label>
  </div>;
}
