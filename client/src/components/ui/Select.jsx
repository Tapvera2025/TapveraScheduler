import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "../../lib/utils";

const Select = React.forwardRef(({ className, wrapperClassName, children, ...props }, ref) => {
  return (
    <div className={cn("relative min-w-0 max-w-full", wrapperClassName)}>
      <select
        className={cn(
          "flex h-10 w-full items-center justify-between rounded-lg border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] px-3 py-2 text-sm text-[hsl(var(--color-foreground))] ring-offset-[hsl(var(--color-background))] placeholder:text-[hsl(var(--color-foreground-muted))] focus:outline-none focus:ring-1 focus:ring-[hsl(var(--color-primary))] focus:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-50 appearance-none pr-8 transition-colors",
          className
        )}
        ref={ref}
        {...props}
      >
        {children}
      </select>
      <ChevronDown className="absolute right-3 top-3 h-4 w-4 text-[hsl(var(--color-muted-foreground))] pointer-events-none" />
    </div>
  );
});

Select.displayName = "Select";

export { Select };
