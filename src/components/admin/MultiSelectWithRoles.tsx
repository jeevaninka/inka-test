'use client';

import { useState, useRef, useEffect } from 'react';
import { ChevronDown, Check, X } from 'lucide-react';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';

export interface MultiSelectItem {
  id: string;
  label: string;
  sublabel?: string;
}

export interface RoleOption {
  value: string;
  label: string;
}

interface MultiSelectWithRolesProps {
  placeholder: string;
  items: MultiSelectItem[];
  selectedRoles: Record<string, string | null | undefined>;
  defaultRole: string;
  roleOptions: RoleOption[];
  onToggleItem: (id: string, checked: boolean) => void;
  onRoleChange: (id: string, role: string) => void;
  emptyText?: string;
}

export function MultiSelectWithRoles({
  placeholder,
  items,
  selectedRoles,
  defaultRole,
  roleOptions,
  onToggleItem,
  onRoleChange,
  emptyText = 'No options available',
}: MultiSelectWithRolesProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    return () => document.removeEventListener('mousedown', handleOutside);
  }, []);

  const selectedItems = items.filter((item) => Boolean(selectedRoles[item.id]));

  const summaryText =
    selectedItems.length === 0
      ? placeholder
      : selectedItems.length === 1
      ? `${selectedItems[0].label} (1 selected)`
      : `${selectedItems.map((i) => i.label).join(', ')} (${selectedItems.length} selected)`;

  return (
    <div className="space-y-2" ref={containerRef}>
      {/* Dropdown Trigger */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className={cn(
            'flex h-9 w-full items-center justify-between rounded-xl border border-input bg-background/80 px-3 text-xs transition-colors hover:bg-muted/30 focus:outline-none focus:ring-1 focus:ring-ring focus:border-primary/50 cursor-pointer',
            selectedItems.length > 0 ? 'text-foreground font-medium' : 'text-muted-foreground'
          )}
        >
          <span className="truncate pr-2">{summaryText}</span>
          <ChevronDown
            className={cn(
              'h-3.5 w-3.5 shrink-0 opacity-60 transition-transform duration-150',
              open && 'rotate-180'
            )}
          />
        </button>

        {/* Dropdown Menu */}
        {open && (
          <div className="absolute left-0 right-0 top-full mt-1.5 z-50 max-h-52 overflow-y-auto rounded-xl border border-border bg-popover p-1.5 text-popover-foreground shadow-2xl">
            {items.length === 0 ? (
              <div className="px-3 py-3 text-center text-xs text-muted-foreground">
                {emptyText}
              </div>
            ) : (
              items.map((item) => {
                const isSelected = Boolean(selectedRoles[item.id]);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onToggleItem(item.id, !isSelected)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors cursor-pointer',
                      isSelected
                        ? 'bg-primary/15 text-primary font-semibold'
                        : 'text-popover-foreground hover:bg-muted/70'
                    )}
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className={cn(
                          'flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors',
                          isSelected
                            ? 'border-primary bg-primary text-primary-foreground'
                            : 'border-border bg-transparent'
                        )}
                      >
                        {isSelected && <Check className="h-3 w-3 stroke-[2.5]" />}
                      </div>
                      <span className="truncate">{item.label}</span>
                      {item.sublabel && (
                        <span className="text-[10px] font-mono text-muted-foreground truncate">
                          {item.sublabel}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>

      {/* Selected Items with Role Pickers */}
      {selectedItems.length > 0 && (
        <div className="space-y-1.5 pt-0.5">
          {selectedItems.map((item) => (
            <div
              key={item.id}
              className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-muted/20 px-3 py-1.5"
            >
              <div className="min-w-0 flex items-center gap-2">
                <span className="text-xs font-medium text-foreground truncate">
                  {item.label}
                </span>
                {item.sublabel && (
                  <span className="text-[10px] font-mono text-muted-foreground hidden sm:inline">
                    {item.sublabel}
                  </span>
                )}
              </div>

              <div className="flex items-center gap-2 shrink-0">
                <Select
                  value={selectedRoles[item.id] || defaultRole}
                  onValueChange={(val) => onRoleChange(item.id, val)}
                  options={roleOptions}
                  className="w-28 h-8 text-xs"
                />
                <button
                  type="button"
                  onClick={() => onToggleItem(item.id, false)}
                  className="p-1 rounded-lg text-muted-foreground hover:text-rose-500 hover:bg-rose-500/10 transition-colors cursor-pointer"
                  title="Remove"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
