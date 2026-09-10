import * as React from "react";
import { cva } from "class-variance-authority";
import { cn } from "../../lib/utils";

// eslint-disable-next-line react-refresh/only-export-components
export const buttonVariants = cva(
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--color-ring))] focus-visible:ring-offset-2 focus-visible:ring-offset-[hsl(var(--color-background))] disabled:pointer-events-none disabled:opacity-45 [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        default: "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] hover:bg-[hsl(var(--color-primary-hover))] shadow-sm",
        primary: "bg-[hsl(var(--color-primary))] text-[hsl(var(--color-primary-foreground))] hover:bg-[hsl(var(--color-primary-hover))] shadow-sm",
        secondary: "bg-[hsl(var(--color-secondary))] text-[hsl(var(--color-secondary-foreground))] hover:bg-[hsl(var(--color-secondary-hover))]",
        success: "bg-[hsl(var(--color-success))] text-[hsl(var(--color-success-foreground))] hover:opacity-90",
        outline: "border border-[hsl(var(--color-border))] bg-[hsl(var(--color-card))] text-[hsl(var(--color-foreground-secondary))] hover:bg-[hsl(var(--color-surface-elevated))] hover:text-[hsl(var(--color-foreground))] shadow-sm",
        ghost: "text-[hsl(var(--color-foreground-secondary))] hover:bg-[hsl(var(--color-secondary))] hover:text-[hsl(var(--color-foreground))]",
        link: "text-[hsl(var(--color-primary))] underline-offset-4 hover:underline",
        danger: "bg-[hsl(var(--color-destructive))] text-[hsl(var(--color-destructive-foreground))] hover:opacity-90",
        destructive: "bg-[hsl(var(--color-destructive))] text-[hsl(var(--color-destructive-foreground))] hover:opacity-90",
      },
      size: { default: "h-10 px-4 py-2", sm: "h-8 px-3 text-xs", lg: "h-12 px-6 text-sm", icon: "h-10 w-10 p-0" },
    },
    defaultVariants: { variant: "default", size: "default" },
  }
);
const Button = React.forwardRef(({ className, variant, size, type = "button", ...props }, ref) => <button type={type} className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />);
Button.displayName = "Button";
export { Button };
export default Button;
