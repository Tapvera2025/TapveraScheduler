import * as React from "react";
import { cn } from "../../lib/utils";
const Switch = React.forwardRef(({ className, checked, onCheckedChange, ...props }, ref) => (
  <button type="button" role="switch" aria-checked={Boolean(checked)} data-state={checked ? "checked" : "unchecked"} onClick={() => onCheckedChange?.(!checked)} ref={ref}
    className={cn("inline-flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors disabled:cursor-not-allowed disabled:opacity-50", checked ? "bg-[hsl(var(--color-primary))]" : "bg-[hsl(var(--color-border-strong))]", className)} {...props}>
    <span className={cn("pointer-events-none block h-5 w-5 rounded-full bg-white shadow-sm transition-transform", checked ? "translate-x-5" : "translate-x-0")} />
  </button>
));
Switch.displayName = "Switch";
export { Switch };
