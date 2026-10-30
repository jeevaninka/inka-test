# Module Sidebar Collapsed Title

## Goal
Show "MODULES" title in small font in the module sidebar header area when collapsed.

## Implementation
In `src/app/(main)/p/[slug]/repository/RepositoryClient.tsx` update the collapsed header area to show "MODULES" text above the expand button.

```tsx
{modulesCollapsed && (
  <div className="border-b border-border/60 py-2 flex flex-col items-center gap-1">
    <span className="text-[9px] uppercase tracking-wider text-muted-foreground font-semibold">MODULES</span>
    <button
      onClick={() => setModulesCollapsed(false)}
      className="w-8 h-8 flex items-center justify-center rounded-lg text-slate-500 hover:text-teal-500 hover:bg-[#E6F3F0] transition-colors cursor-pointer"
      aria-label="Expand Modules"
      title="Expand Modules"
    >
      <PanelLeftOpen className="h-[18px] w-[18px]" strokeWidth={1.5} />
    </button>
  </div>
)}
```
