import { useMemo, useState, useEffect } from "react";
import { Select } from "./Select";
import { Input } from "./Input";
import { STATE_GROUPS } from "../../constants/locations";

/**
 * StateInput
 *
 * Grouped state/territory picker for Australia + India, with an "Other
 * (enter manually)" escape hatch that swaps the Select for a free-text
 * Input for anywhere the presets don't cover.
 *
 * Behaviour:
 *   - `value` is a plain string (a code like "NSW" / "KA", or free text).
 *   - If value matches a preset code, the Select shows it selected and the
 *     free-text Input is hidden.
 *   - If value is non-empty and matches no preset, we treat it as "Other"
 *     and render the Input pre-filled. Useful when editing a record that
 *     was saved with a custom state.
 *   - Picking "Other (enter manually)" clears the value and shows the
 *     Input so the user can type.
 *
 * Props:
 *   value        Current value (string)
 *   onChange     (nextValue: string) => void
 *   className    Optional wrapper class
 *   disabled     Standard disabled flag
 *   id           Optional id, forwarded to Select for label htmlFor
 */
export function StateInput({ value = "", onChange, className, disabled, id }) {
  const presetCodes = useMemo(
    () => new Set(STATE_GROUPS.flatMap((g) => g.options.map((o) => o.code))),
    []
  );

  const initialCustom = Boolean(value) && !presetCodes.has(value);
  const [customMode, setCustomMode] = useState(initialCustom);

  // Sync customMode when the parent replaces value (e.g. autofill from geocode).
  useEffect(() => {
    if (value && !presetCodes.has(value)) {
      setCustomMode(true);
    } else if (!value) {
      // parent cleared; drop custom mode so the user sees the picker again
      setCustomMode(false);
    }
  }, [value, presetCodes]);

  const handleSelectChange = (e) => {
    const next = e.target.value;
    if (next === "__custom__") {
      setCustomMode(true);
      onChange("");
      return;
    }
    onChange(next);
  };

  const handleCustomInput = (e) => {
    onChange(e.target.value);
  };

  if (customMode) {
    return (
      <div className={className}>
        <Input
          id={id}
          value={value}
          onChange={handleCustomInput}
          placeholder="Enter state / region"
          disabled={disabled}
        />
        <button
          type="button"
          onClick={() => {
            setCustomMode(false);
            onChange("");
          }}
          className="text-xs text-[hsl(var(--color-primary))] hover:underline mt-1"
        >
          Choose from list instead
        </button>
      </div>
    );
  }

  return (
    <Select
      id={id}
      value={value}
      onChange={handleSelectChange}
      className={className}
      disabled={disabled}
    >
      <option value="">Select State</option>
      {STATE_GROUPS.map((group) => (
        <optgroup key={group.label} label={group.label}>
          {group.options.map((opt) => (
            <option key={`${group.label}-${opt.code}`} value={opt.code}>
              {opt.code} - {opt.name}
            </option>
          ))}
        </optgroup>
      ))}
      <option value="__custom__">Other (enter manually)…</option>
    </Select>
  );
}

export default StateInput;
