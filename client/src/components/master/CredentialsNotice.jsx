import { CheckCircle2, AlertTriangle, Copy } from "lucide-react";
import { Button } from "../ui/Button";
import { toast } from "react-hot-toast";

/**
 * CredentialsNotice - what happened after issuing an admin's login details
 *
 * When the email went out there is nothing to show but confirmation. When it
 * failed, the password is displayed here because it exists nowhere else — it is
 * stored only as a hash.
 */
export default function CredentialsNotice({ result, onDismiss }) {
  if (!result) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(result.password);
      toast.success("Password copied");
    } catch {
      toast.error("Could not copy — select and copy it manually");
    }
  };

  if (result.emailSent) {
    return (
      <div className="flex items-start gap-3 p-4 rounded-xl border border-[hsl(var(--color-success))]/30 bg-[hsl(var(--color-success-soft))]">
        <CheckCircle2 className="w-5 h-5 text-[hsl(var(--color-success))] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[hsl(var(--color-foreground))]">
            Login details emailed to {result.email}
          </p>
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5">
            They should change the password after signing in.
          </p>
        </div>
        {onDismiss && (
          <Button variant="ghost" size="sm" onClick={onDismiss}>
            Dismiss
          </Button>
        )}
      </div>
    );
  }

  return (
    <div className="p-4 rounded-xl border border-[hsl(var(--color-warning))]/30 bg-[hsl(var(--color-warning-soft))]">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-[hsl(var(--color-warning))] flex-shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-[hsl(var(--color-foreground))]">
            The account was created, but the email could not be sent
          </p>
          <p className="text-sm text-[hsl(var(--color-foreground-secondary))] mt-0.5">
            Pass these details on yourself. The password is not stored in
            readable form, so it cannot be shown again.
          </p>
          {result.emailError && (
            <p className="text-xs text-[hsl(var(--color-foreground-muted))] mt-1">
              Reason: {result.emailError}
            </p>
          )}
          <div className="mt-3 space-y-1 text-sm">
            <p className="text-[hsl(var(--color-foreground))]">
              <span className="text-[hsl(var(--color-foreground-secondary))]">Email: </span>
              {result.email}
            </p>
            <div className="flex items-center gap-2">
              <span className="text-[hsl(var(--color-foreground-secondary))]">Password: </span>
              <code className="px-2 py-1 rounded bg-[hsl(var(--color-surface))] font-mono text-[hsl(var(--color-foreground))]">
                {result.password}
              </code>
              <Button variant="ghost" size="sm" onClick={copy}>
                <Copy className="w-4 h-4" />
              </Button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
