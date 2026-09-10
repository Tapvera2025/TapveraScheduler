import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-medium border transition-colors",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--color-secondary))] text-[hsl(var(--color-secondary-foreground))] border-transparent",
        muted: "bg-[hsl(var(--color-muted))] text-[hsl(var(--color-foreground-secondary))] border-transparent",
        success: "bg-[hsl(var(--color-success-soft))] text-[hsl(var(--color-success))] border-[hsl(var(--color-success))]/20",
        warning: "bg-[hsl(var(--color-warning-soft))] text-[hsl(var(--color-warning))] border-[hsl(var(--color-warning))]/20",
        error: "bg-[hsl(var(--color-error-soft))] text-[hsl(var(--color-error))] border-[hsl(var(--color-error))]/20",
        info: "bg-[hsl(var(--color-info-soft))] text-[hsl(var(--color-info))] border-[hsl(var(--color-info))]/20",
        outline: "bg-transparent text-[hsl(var(--color-foreground))] border-[hsl(var(--color-border))]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
);

const Badge = React.forwardRef(({ className, variant, status, children, ...props }, ref) => {
  const normalized = typeof status === "string" ? status.toLowerCase() : "";
  const statusVariant = { active: "success", inactive: "muted", pending: "warning", approved: "success", declined: "error", cancelled: "muted" }[normalized];
  return (
    <span
      ref={ref}
      className={cn(badgeVariants({ variant: variant || statusVariant }), className)}
      {...props}
    >{children ?? (normalized ? normalized.charAt(0).toUpperCase() + normalized.slice(1) : null)}</span>
  );
});

Badge.displayName = "Badge";

// eslint-disable-next-line react-refresh/only-export-components
export { Badge, badgeVariants };
export default Badge;
