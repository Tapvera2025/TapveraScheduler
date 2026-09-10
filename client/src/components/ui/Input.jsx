import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef(({ className, type, ...props }, ref) => {
  return (
    <input
      type={type}
      className={cn(
        "flex h-10 w-full rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2 text-sm text-[hsl(var(--color-foreground))] ring-offset-[hsl(var(--color-background))] file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-[hsl(var(--color-foreground-muted))] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[hsl(var(--color-primary))] focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 transition-colors",
        className
      )}
      ref={ref}
      {...props}
    />
  );
});

Input.displayName = "Input";

export { Input };
