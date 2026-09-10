import { Switch } from "../ui/Switch";

/**
 * ModulePicker - module switches with their dependencies handled
 *
 * Switching a module on pulls in whatever it needs; switching one off also
 * switches off anything that depends on it. The catalogue (including the
 * dependency graph) comes from the server, so this cannot drift from it.
 */
export default function ModulePicker({ catalogue, selected, onChange, disabled }) {
  const byKey = {};
  catalogue.forEach((module) => {
    byKey[module.key] = module;
  });

  const addWithDependencies = (key, set) => {
    if (!byKey[key] || set.has(key)) return;
    set.add(key);
    (byKey[key].dependsOn || []).forEach((dependency) =>
      addWithDependencies(dependency, set)
    );
  };

  const removeWithDependents = (key, set) => {
    if (!set.has(key)) return;
    set.delete(key);
    catalogue
      .filter((module) => (module.dependsOn || []).includes(key))
      .forEach((module) => removeWithDependents(module.key, set));
  };

  const toggle = (key) => {
    const next = new Set(selected);

    if (next.has(key)) {
      removeWithDependents(key, next);
    } else {
      addWithDependencies(key, next);
    }

    // Keep catalogue order so the list never jumps around
    onChange(catalogue.map((m) => m.key).filter((k) => next.has(k)));
  };

  return (
    <div className="space-y-2">
      {catalogue.map((module) => {
        const isOn = selected.includes(module.key);
        const needs = (module.dependsOn || []).map((key) => byKey[key]?.label || key);
        const usedBy = catalogue
          .filter((m) => (m.dependsOn || []).includes(module.key) && selected.includes(m.key))
          .map((m) => m.label);

        return (
          <div
            key={module.key}
            className="flex items-start justify-between gap-4 p-4 rounded-xl border border-[hsl(var(--color-border))] bg-[hsl(var(--color-surface-elevated))]"
          >
            <div className="min-w-0">
              <p className="font-medium text-[hsl(var(--color-foreground))]">
                {module.label}
              </p>
              <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5">
                {module.description}
              </p>
              {needs.length > 0 && (
                <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1">
                  Needs: {needs.join(", ")}
                </p>
              )}
              {isOn && usedBy.length > 0 && (
                <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1">
                  Switching this off also switches off: {usedBy.join(", ")}
                </p>
              )}
            </div>
            <Switch
              checked={isOn}
              onCheckedChange={() => toggle(module.key)}
              disabled={disabled}
            />
          </div>
        );
      })}
    </div>
  );
}
