import { cn } from "../../lib/utils";

/**
 * The page header every workspace screen shares.
 *
 * This is the `.data-page-header` pattern: a full-bleed translucent bar with a
 * bottom rule, a coloured symbol tile, and the same Manrope title treatment the
 * dashboard uses. Keeping it in one component is what stops the pages drifting
 * apart again - a screen gets the current look by using this, not by copying
 * markup.
 *
 *   eyebrow    10px / 650 / .14em tracking / muted
 *   title      Manrope, clamp(20px, 2vw, 27px), 650, -.055em
 *   kicker     11px / muted
 */
export default function PageHeader({ title, description, eyebrow, icon: Icon, actions, className }) {
  return (
    <header className={cn("data-page-header", className)}>
      <div className="data-page-header-inner">
        <div className="data-page-titleline">
          {Icon && (
            <span className="data-page-symbol">
              <Icon size={19} strokeWidth={1.7} />
            </span>
          )}
          <div className="data-page-copy">
            {eyebrow && <p className="eyebrow">{eyebrow}</p>}
            <h1 className="data-page-title">{title}</h1>
            {description && <p className="data-page-kicker">{description}</p>}
          </div>
        </div>
        {actions && <div className="data-header-tools">{actions}</div>}
      </div>
    </header>
  );
}
