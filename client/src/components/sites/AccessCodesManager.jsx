import { useState, useEffect, useCallback } from "react";
import { Key, Eye, EyeOff, Trash2, Plus, Loader2, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "../ui/Button";
import { Input } from "../ui/Input";
import { Label } from "../ui/Label";
import { Textarea } from "../ui/Textarea";
import { siteApi } from "../../lib/api";
import toast from "react-hot-toast";

/**
 * AccessCodesManager
 *
 * Full list + add + delete for a site's access codes. Live against the API
 * (needs an existing site id). For the "brand-new site" flow (no id yet),
 * the parent should render a simpler placeholder — codes only make sense
 * after the site is saved so the server has a siteId to attach them to.
 *
 * Props:
 *   siteId (string, required) — existing site's id
 */
export default function AccessCodesManager({ siteId }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(() => new Set());
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showNewCode, setShowNewCode] = useState(false);

  const [draft, setDraft] = useState({
    codeName: "",
    accessCode: "",
    notes: "",
    visibleOnMobile: false,
    whenRostered: false,
    afterClockingIn: false,
  });

  const resetDraft = () =>
    setDraft({
      codeName: "",
      accessCode: "",
      notes: "",
      visibleOnMobile: false,
      whenRostered: false,
      afterClockingIn: false,
    });

  const load = useCallback(async () => {
    if (!siteId) return;
    setLoading(true);
    try {
      const res = await siteApi.getAccessCodes(siteId);
      const list = res.data?.data || [];
      setCodes(Array.isArray(list) ? list : []);
    } catch (err) {
      console.error("Failed to load access codes", err);
      toast.error(err.response?.data?.message || "Failed to load access codes");
    } finally {
      setLoading(false);
    }
  }, [siteId]);

  useEffect(() => {
    load();
  }, [load]);

  const toggleReveal = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleAdd = async () => {
    if (!draft.codeName.trim() || !draft.accessCode.trim()) {
      toast.error("Code name and access code are required");
      return;
    }
    if (draft.visibleOnMobile && !draft.whenRostered && !draft.afterClockingIn) {
      toast.error("Select when employees should see this code: 'When rostered' or 'After clocking in'");
      return;
    }
    setSubmitting(true);
    try {
      await siteApi.addAccessCode(siteId, {
        codeName: draft.codeName.trim(),
        accessCode: draft.accessCode.trim(),
        notes: draft.notes.trim() || undefined,
        visibleOnMobile: draft.visibleOnMobile,
        whenRostered: draft.whenRostered,
        afterClockingIn: draft.afterClockingIn,
      });
      toast.success("Access code added");
      resetDraft();
      setShowNewCode(false);
      setShowForm(false);
      await load();
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to add access code");
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (codeId) => {
    if (!window.confirm("Delete this access code? This cannot be undone.")) return;
    try {
      await siteApi.deleteAccessCode(siteId, codeId);
      toast.success("Access code deleted");
      setCodes((prev) => prev.filter((c) => (c.id || c._id) !== codeId));
    } catch (err) {
      toast.error(err.response?.data?.message || "Failed to delete access code");
    }
  };

  return (
    <div className="space-y-4">
      {/* Existing codes list */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-[hsl(var(--color-foreground))] flex items-center gap-2">
            <Key className="w-4 h-4" />
            Access Codes
            {codes.length > 0 && (
              <span className="text-xs font-normal text-[hsl(var(--color-foreground-secondary))]">
                ({codes.length})
              </span>
            )}
          </h3>
          <Button
            variant="outline"
            onClick={() => setShowForm((v) => !v)}
            className="text-sm"
          >
            <Plus className="w-4 h-4 mr-1" />
            {showForm ? "Cancel" : "Add code"}
          </Button>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-[hsl(var(--color-foreground-secondary))] py-4">
            <Loader2 className="w-4 h-4 animate-spin" />
            Loading access codes…
          </div>
        ) : codes.length === 0 ? (
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] py-4">
            No access codes yet. Add one so employees can be given entry
            credentials for this site.
          </p>
        ) : (
          <div className="space-y-2">
            {codes.map((code) => {
              const id = code.id || code._id;
              const shown = revealed.has(id);
              return (
                <div
                  key={id}
                  className="border border-[hsl(var(--color-border))] rounded p-3 flex items-start gap-3"
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-[hsl(var(--color-foreground))]">
                        {code.codeName}
                      </span>
                      <code className="px-2 py-0.5 bg-[hsl(var(--color-surface-elevated))] rounded font-mono text-sm">
                        {shown ? code.accessCode : "•".repeat(Math.min(8, code.accessCode?.length || 4))}
                      </code>
                      <button
                        type="button"
                        onClick={() => toggleReveal(id)}
                        className="text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))]"
                        aria-label={shown ? "Hide code" : "Reveal code"}
                      >
                        {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                      </button>
                    </div>
                    {code.notes && (
                      <p className="text-xs text-[hsl(var(--color-foreground-secondary))] mt-1">
                        {code.notes}
                      </p>
                    )}
                    <div className="flex flex-wrap gap-1 mt-2 text-[10px]">
                      <VisibilityBadge active={code.visibleOnMobile} label="Mobile" />
                      <VisibilityBadge active={code.whenRostered} label="When rostered" />
                      <VisibilityBadge active={code.afterClockingIn} label="After clock-in" />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => handleDelete(id)}
                    className="text-[hsl(var(--color-error))] hover:text-[hsl(var(--color-error))]/80 p-1"
                    aria-label="Delete code"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Add form */}
      {showForm && (
        <div className="border border-[hsl(var(--color-border))] rounded p-4 bg-[hsl(var(--color-surface-elevated))] space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div>
              <Label>Code Name *</Label>
              <Input
                value={draft.codeName}
                onChange={(e) => setDraft({ ...draft, codeName: e.target.value })}
                placeholder="e.g. Front Gate, Alarm Panel"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Access Code *</Label>
              <div className="relative">
                <Input
                  type={showNewCode ? "text" : "password"}
                  value={draft.accessCode}
                  onChange={(e) => setDraft({ ...draft, accessCode: e.target.value })}
                  className="mt-1 pr-10"
                  placeholder="Enter the code"
                />
                <button
                  type="button"
                  onClick={() => setShowNewCode((v) => !v)}
                  className="absolute right-3 top-1/2 transform -translate-y-1/2 text-[hsl(var(--color-foreground-secondary))]"
                >
                  {showNewCode ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>

          <div>
            <Label>Notes</Label>
            <Textarea
              value={draft.notes}
              onChange={(e) => setDraft({ ...draft, notes: e.target.value })}
              placeholder="Extra instructions (optional)"
              rows={2}
              className="mt-1"
            />
          </div>

          <div className="space-y-2">
            <Label>Visibility</Label>
            <VisibilityCheckbox
              label="Visible on mobile"
              hint="Master switch. If off, this code is admin-only and no employee ever sees it."
              checked={draft.visibleOnMobile}
              onChange={(v) =>
                setDraft({
                  ...draft,
                  visibleOnMobile: v,
                  // Default to whenRostered when first enabling mobile visibility
                  // so codes are visible without requiring a second step.
                  whenRostered: v && !draft.whenRostered && !draft.afterClockingIn ? true : draft.whenRostered,
                })
              }
            />
            <VisibilityCheckbox
              label="Show when rostered"
              hint="Reveal the code as soon as the employee is assigned to a shift at this site."
              checked={draft.whenRostered}
              onChange={(v) => setDraft({ ...draft, whenRostered: v })}
              disabled={!draft.visibleOnMobile}
            />
            <VisibilityCheckbox
              label="Show after clocking in"
              hint="Only reveal after the employee successfully clocks in on-site. More secure than 'when rostered'."
              checked={draft.afterClockingIn}
              onChange={(v) => setDraft({ ...draft, afterClockingIn: v })}
              disabled={!draft.visibleOnMobile}
            />
            {draft.visibleOnMobile && !draft.whenRostered && !draft.afterClockingIn && (
              <p className="text-xs text-[hsl(var(--color-warning,var(--color-error)))] mt-1">
                Select at least one option above — otherwise employees will see this code as locked.
              </p>
            )}
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowForm(false);
                resetDraft();
              }}
              disabled={submitting}
            >
              Cancel
            </Button>
            <Button onClick={handleAdd} disabled={submitting}>
              {submitting ? "Saving…" : "Save code"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function VisibilityBadge({ active, label }) {
  return (
    <span
      className={`px-1.5 py-0.5 rounded border ${
        active
          ? "bg-[hsl(var(--color-success))]/10 border-[hsl(var(--color-success))]/30 text-[hsl(var(--color-success))]"
          : "bg-[hsl(var(--color-surface-elevated))] border-[hsl(var(--color-border))] text-[hsl(var(--color-foreground-muted))]"
      }`}
    >
      {active ? "✓" : "×"} {label}
    </span>
  );
}

function VisibilityCheckbox({ label, hint, checked, onChange, disabled }) {
  return (
    <label
      className={`flex items-start gap-2 p-2 rounded cursor-pointer hover:bg-[hsl(var(--color-card))] ${
        disabled ? "opacity-50 cursor-not-allowed" : ""
      }`}
    >
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 w-4 h-4 rounded"
      />
      <div className="flex-1 text-sm">
        <div className="text-[hsl(var(--color-foreground))]">{label}</div>
        <div className="text-xs text-[hsl(var(--color-foreground-secondary))]">{hint}</div>
      </div>
    </label>
  );
}
