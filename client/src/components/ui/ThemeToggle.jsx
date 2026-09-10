import { Sun, Moon, Monitor } from "lucide-react";
import { useThemeStore } from "../../store/themeStore";

export default function ThemeToggle({ expanded = false }) {
  const { preference, resolved, setTheme } = useThemeStore();
  if (expanded) return (
    <div className="theme-options" role="group" aria-label="Appearance">
      {[{ value: "light", label: "Light", icon: Sun }, { value: "dark", label: "Dark", icon: Moon }, { value: "system", label: "System", icon: Monitor }].map(({ value, label, icon: Icon }) => (
        <button type="button" key={value} onClick={() => setTheme(value)} aria-pressed={preference === value}>
          <Icon size={16} /><span>{label}</span>
        </button>
      ))}
    </div>
  );
  return (
    <button type="button" className="icon-button theme-toggle" onClick={() => setTheme(resolved === "dark" ? "light" : "dark")} aria-label={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`} title={`Switch to ${resolved === "dark" ? "light" : "dark"} mode`}>
      {resolved === "dark" ? <Sun size={18} /> : <Moon size={18} />}
    </button>
  );
}
