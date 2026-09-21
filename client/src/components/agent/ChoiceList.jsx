import { useState } from "react";
import { Button } from "../ui/Button";
import { Select } from "../ui/Select";

/**
 * The answers to a question the agent just asked.
 *
 * "Which site should the shift be at?" used to arrive on its own, which sent
 * the admin off to another screen to look a name up in the middle of a
 * sentence. The tool knows the options, so it sends them and they are picked
 * here.
 *
 * A handful of options are laid out as buttons: everything is visible and it
 * costs one tap. Past that a list of buttons stops being scannable, so it
 * becomes a dropdown. Either way the id goes back to the tool, so nothing
 * depends on spelling the name the way the database does.
 */

const CHIP_LIMIT = 8;

const subtitle = (c) =>
  [c.position, c.department, c.shortName, c.state, c.where, c.timezone]
    .filter(Boolean)
    .join(" · ") || "—";

export default function ChoiceList({
  entity,
  candidates = [],
  truncated = false,
  label = "CHOOSE ONE",
  disabled = false,
  onChoose,
}) {
  const [selectedId, setSelectedId] = useState("");

  if (!entity || candidates.length === 0) return null;

  const asChips = candidates.length <= CHIP_LIMIT;

  return (
    <div className="agent-candidates mt-2">
      <p className="eyebrow">{label}</p>

      {asChips &&
        candidates.map((c) => (
          <button
            key={c.id}
            type="button"
            className="agent-candidate"
            disabled={disabled}
            onClick={() => onChoose?.(entity, c)}
          >
            <strong>{c.name}</strong>
            <span>{subtitle(c)}</span>
          </button>
        ))}

      {!asChips && (
        <div className="agent-choice-picker">
          <Select
            aria-label={`Choose a ${entity}`}
            value={selectedId}
            disabled={disabled}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            <option value="">Select a {entity}…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.shortName ? `${c.name} (${c.shortName})` : c.name}
              </option>
            ))}
          </Select>
          <Button
            size="sm"
            disabled={disabled || !selectedId}
            onClick={() => {
              const picked = candidates.find((c) => c.id === selectedId);
              if (picked) onChoose?.(entity, picked);
            }}
          >
            Use this {entity}
          </Button>
        </div>
      )}

      {truncated && (
        <p className="agent-note">
          Only the first {candidates.length} are shown. Type the name if the one you want is missing.
        </p>
      )}
    </div>
  );
}
