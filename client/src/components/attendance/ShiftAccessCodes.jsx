import { useEffect, useState, useCallback } from "react";
import { Key, Lock, Eye, EyeOff, Loader2 } from "lucide-react";
import { shiftApi } from "../../lib/api";

/**
 * ShiftAccessCodes
 *
 * Shows the access codes that the currently logged-in employee is allowed
 * to see for a given shift. The server does the visibility filtering
 * (admin-only codes never come down; afterClockingIn codes come back as
 * `locked` until the user has clocked in).
 *
 * Props:
 *   shiftId (string, required) — the shift being viewed
 *   refreshKey (any, optional)  — bump this from the parent (e.g. after
 *     successful clock-in) to force a refetch so newly-unlocked codes reveal.
 */
export default function ShiftAccessCodes({ shiftId, refreshKey }) {
  const [codes, setCodes] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [revealed, setRevealed] = useState(() => new Set());

  const load = useCallback(async () => {
    if (!shiftId) {
      setCodes([]);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const res = await shiftApi.getAccessCodes(shiftId);
      const list = res.data?.data || [];
      setCodes(Array.isArray(list) ? list : []);
    } catch (err) {
      // 404 just means the shift isn't found for this employee — surface
      // silently, not as an error banner.
      if (err.response?.status === 404) {
        setCodes([]);
      } else {
        setError(err.response?.data?.message || "Failed to load access codes");
      }
    } finally {
      setLoading(false);
    }
  }, [shiftId]);

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const toggleReveal = (id) => {
    setRevealed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-[hsl(var(--color-foreground-secondary))] py-2">
        <Loader2 className="w-4 h-4 animate-spin" />
        Loading access codes…
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-sm text-[hsl(var(--color-error))] py-2">
        {error}
      </div>
    );
  }

  if (codes.length === 0) return null;

  return (
    <div className="border border-[hsl(var(--color-border))] rounded-lg p-4 bg-[hsl(var(--color-surface-elevated))]">
      <h3 className="text-sm font-semibold text-[hsl(var(--color-foreground))] mb-3 flex items-center gap-2">
        <Key className="w-4 h-4" />
        Site Access Codes
      </h3>
      <div className="space-y-2">
        {codes.map((code) => {
          if (code.locked) {
            return (
              <div
                key={code.id}
                className="flex items-start gap-3 p-3 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]"
              >
                <Lock className="w-4 h-4 text-[hsl(var(--color-foreground-muted))] mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-[hsl(var(--color-foreground))]">
                    {code.codeName}
                  </div>
                  <div className="text-xs text-[hsl(var(--color-foreground-secondary))] mt-0.5">
                    {code.lockedReason}
                  </div>
                  {code.notes && (
                    <div className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1">
                      {code.notes}
                    </div>
                  )}
                </div>
              </div>
            );
          }

          const shown = revealed.has(code.id);
          return (
            <div
              key={code.id}
              className="flex items-start gap-3 p-3 rounded border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))]"
            >
              <Key className="w-4 h-4 text-[hsl(var(--color-primary))] mt-0.5 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[hsl(var(--color-foreground))]">
                  {code.codeName}
                </div>
                <div className="flex items-center gap-2 mt-1">
                  <code className="px-2 py-0.5 bg-[hsl(var(--color-surface-elevated))] rounded font-mono text-sm text-[hsl(var(--color-foreground))]">
                    {shown ? code.accessCode : "•".repeat(Math.min(10, code.accessCode?.length || 4))}
                  </code>
                  <button
                    type="button"
                    onClick={() => toggleReveal(code.id)}
                    className="text-[hsl(var(--color-foreground-secondary))] hover:text-[hsl(var(--color-foreground))]"
                    aria-label={shown ? "Hide code" : "Reveal code"}
                  >
                    {shown ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {code.notes && (
                  <div className="text-xs text-[hsl(var(--color-foreground-secondary))] mt-1">
                    {code.notes}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
