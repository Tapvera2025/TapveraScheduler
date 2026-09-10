import {
  User,
  MapPin,
  LayoutGrid,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Settings,
  RotateCcw,
  Printer,
} from "lucide-react";

export default function SchedulerHeader() {
  return (
    <div className="bg-[hsl(var(--color-card))] border-b border-[hsl(var(--color-border))] px-3 sm:px-6 py-3">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
        {/* Left Section */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Site Selector */}
          <div className="relative min-w-[200px]">
            <select className="w-full px-3 py-2 border border-[hsl(var(--color-border))] rounded-md text-sm text-[hsl(var(--color-foreground-secondary))] bg-[hsl(var(--color-card))] cursor-pointer focus:outline-none focus:ring-2 focus:ring-[hsl(var(--color-ring))]">
              <option>Select Site...</option>
              <option>Elimbah Stabling Yard</option>
              <option>Woombay Stabling Yard</option>
              <option>Mayne Stabling Yard</option>
            </select>
          </div>

          {/* Icon Buttons */}
          <div className="flex items-center gap-1">
            <button
              className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
              title="User View"
            >
              <User className="w-4 h-4 text-[hsl(var(--color-primary))]" />
            </button>
            <button
              className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
              title="Location"
            >
              <MapPin className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
            </button>
            <button
              className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
              title="Grid View"
            >
              <LayoutGrid className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
            </button>
          </div>
        </div>

        {/* Center Section - Date Range */}
        <div className="flex items-center gap-2">
          <button className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors">
            <ChevronLeft className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
          <button className="px-4 py-2 border border-[hsl(var(--color-border))] rounded text-sm font-medium text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors flex items-center gap-2 whitespace-nowrap">
            1 - 28 Dec 2025
            <ChevronDown className="w-4 h-4" />
          </button>
          <button className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors">
            <ChevronRight className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
        </div>

        {/* Right Section */}
        <div className="flex items-center gap-2 flex-wrap">
          <button className="px-3 py-2 border border-[hsl(var(--color-border))] rounded text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors flex items-center gap-2">
            4 Weeks
            <ChevronDown className="w-4 h-4" />
          </button>
          <button
            className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
            title="Settings"
          >
            <Settings className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
          <button
            className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
            title="Refresh"
          >
            <RotateCcw className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
          <button
            className="p-2 border border-[hsl(var(--color-border))] rounded hover:bg-[hsl(var(--color-surface-elevated))] transition-colors"
            title="Print"
          >
            <Printer className="w-4 h-4 text-[hsl(var(--color-foreground-secondary))]" />
          </button>
          <button className="px-3 py-2 border border-[hsl(var(--color-border))] rounded text-sm text-[hsl(var(--color-foreground))] hover:bg-[hsl(var(--color-surface-elevated))] transition-colors flex items-center gap-2">
            Options
            <ChevronDown className="w-4 h-4" />
          </button>
          <button className="px-4 py-2 bg-[hsl(var(--color-success))] text-[hsl(var(--color-success-foreground))] rounded text-sm font-medium hover:bg-[hsl(var(--color-success))] transition-colors whitespace-nowrap">
            No Shifts Published
          </button>
        </div>
      </div>
    </div>
  );
}
