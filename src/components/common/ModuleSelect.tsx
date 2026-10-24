"use client";

import React, { useMemo, useState } from "react";
import { Check, ChevronDown, ChevronRight, Folder, Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";

export type ModuleSelectValue = string; // module id | 'auto' | '' | '__new_module__'

interface ModuleSelectProps {
  modules: any[];
  value: ModuleSelectValue;
  onChange: (value: string) => void;
  /** Show the "auto-detect" option. */
  allowAutoDetect?: boolean;
  /** Show the "no module" option. */
  allowNone?: boolean;
  noneLabel?: string;
  autoLabel?: string;
  /** Optional prefix added before the module name (e.g. "Module:"). */
  labelPrefix?: string;
  /** Compact style for inline rows (per-case pickers). */
  size?: "md" | "sm";
  /** Creates a module and returns its id. When omitted, `onRequestCreate` is used. */
  onInlineCreate?: (name: string) => Promise<string | null>;
  /** Fallback when no async creator is provided. */
  onRequestCreate?: () => void;
  disabled?: boolean;
  className?: string;
}

const CREATE_VALUE = "__new_module__";

function buildTree(modules: any[]) {
  const roots = modules.filter((m) => !m.parentId);
  const childrenOf = (parentId: string) => modules.filter((m) => m.parentId === parentId);
  return { roots, childrenOf };
}

/**
 * Searchable, hierarchical module picker.
 * Root modules are listed; hovering one that has sub-modules slides out a
 * sideover submenu. Search matches roots and sub-modules (with breadcrumbs).
 */
export function ModuleSelect({
  modules,
  value,
  onChange,
  allowAutoDetect = false,
  allowNone = true,
  noneLabel = "No module (Root)",
  autoLabel = "✨ Auto-detect module",
  labelPrefix,
  size = "md",
  onInlineCreate,
  onRequestCreate,
  disabled = false,
  className,
}: ModuleSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [creating, setCreating] = useState(false);
  const [createName, setCreateName] = useState("");

  const { roots, childrenOf } = useMemo(() => buildTree(modules || []), [modules]);

  const selectedModule = useMemo(
    () => (modules || []).find((m) => m.id === value) || null,
    [modules, value]
  );

  const triggerLabel = useMemo(() => {
    if (value === CREATE_VALUE) return "Create new module…";
    if (allowAutoDetect && value === "auto") return autoLabel;
    if (!value) return allowNone ? noneLabel : "Select module";
    const parent = selectedModule?.parentId
      ? (modules || []).find((m) => m.id === selectedModule.parentId)
      : null;
    const name = parent ? `${parent.name} › ${selectedModule?.name}` : selectedModule?.name || "Select module";
    return labelPrefix ? `${labelPrefix} ${name}` : name;
  }, [value, allowAutoDetect, autoLabel, allowNone, noneLabel, selectedModule, modules, labelPrefix]);

  // Search matches roots and sub-modules (breadcrumbed).
  const searchResults = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [];
    const out: { id: string; label: string; isChild: boolean }[] = [];
    for (const root of roots) {
      if (root.name.toLowerCase().includes(q)) {
        out.push({ id: root.id, label: root.name, isChild: false });
      }
      for (const child of childrenOf(root.id)) {
        if (child.name.toLowerCase().includes(q)) {
          out.push({ id: child.id, label: `${root.name} › ${child.name}`, isChild: true });
        }
      }
    }
    return out;
  }, [roots, childrenOf, search]);

  const hasQuery = search.trim().length > 0;

  const handleCreate = async () => {
    const name = createName.trim();
    if (!name) return;
    if (onInlineCreate) {
      const id = await onInlineCreate(name);
      if (id) {
        onChange(id);
        setCreating(false);
        setCreateName("");
        setSearch("");
        setOpen(false);
      }
      return;
    }
    onRequestCreate?.();
    setCreating(false);
    setCreateName("");
    setOpen(false);
  };

  const requestCreate = () => {
    setCreating(true);
    setCreateName(search.trim());
  };

  const renderCheck = (id: string) =>
    value === id && <Check className="h-3.5 w-3.5 text-primary shrink-0" />;

  const itemClass =
    size === "sm"
      ? "py-1 px-2 text-[11px]"
      : "py-1.5 px-2.5 text-xs";

  return (
    <DropdownMenu open={open} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          disabled={disabled}
          className={cn(
            "inline-flex max-w-full items-center justify-between gap-2 rounded-lg border border-input bg-background/80 px-3 font-medium text-foreground shadow-xs transition-colors hover:bg-primary/10 hover:text-primary hover:border-primary/40 focus:outline-none focus:ring-1 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-50 cursor-pointer text-left",
            size === "sm" ? "h-6 text-[11px]" : "h-9 text-xs",
            className
          )}
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown
            className={cn(
              "h-3.5 w-3.5 shrink-0 transition-transform duration-150",
              open && "rotate-180"
            )}
          />
        </button>
      </DropdownMenuTrigger>

      <DropdownMenuContent
        align="start"
        className="z-[100] w-64 max-h-[340px] overflow-y-auto rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl"
        style={{ minWidth: "var(--radix-dropdown-menu-trigger-width)" }}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        {/* Search */}
        <div className="sticky top-0 z-10 bg-popover px-1 pb-1 pt-0.5">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              onKeyDown={(e) => e.stopPropagation()}
              onPointerDown={(e) => e.stopPropagation()}
              placeholder="Search modules…"
              className="h-8 w-full rounded-lg border border-border/60 bg-background pl-8 pr-7 text-xs outline-none focus:ring-1 focus:ring-primary"
            />
            {search && (
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => setSearch("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {hasQuery ? (
          <>
            {searchResults.length === 0 ? (
              <div className="px-2.5 py-2 text-xs text-muted-foreground italic">
                No modules found
              </div>
            ) : (
              searchResults.map((r) => (
                <DropdownMenuItem
                  key={r.id}
                  onSelect={() => {
                    onChange(r.id);
                    setSearch("");
                  }}
                  className={cn(itemClass, "flex items-center gap-2")}
                >
                  <Folder
                    className={cn(
                      "h-3.5 w-3.5 shrink-0",
                      r.isChild ? "text-muted-foreground" : "text-primary"
                    )}
                  />
                  <span className="flex-1 truncate">
                    {r.label}
                    {r.isChild && (
                      <span className="ml-1.5 text-[10px] text-muted-foreground">sub</span>
                    )}
                  </span>
                  {renderCheck(r.id)}
                </DropdownMenuItem>
              ))
            )}

            {onInlineCreate && (
              <DropdownMenuItem
                onSelect={(e) => {
                  e.preventDefault();
                  requestCreate();
                }}
                className={cn(itemClass, "flex items-center gap-2")}
              >
                <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">Create “{search.trim()}”…</span>
              </DropdownMenuItem>
            )}
          </>
        ) : (
          <>
            {allowAutoDetect && (
              <DropdownMenuItem
                onSelect={() => onChange("auto")}
                className={cn(itemClass, "flex items-center gap-2")}
              >
                <span className="flex-1 truncate">{autoLabel}</span>
                {renderCheck("auto")}
              </DropdownMenuItem>
            )}
            {allowNone && (
              <DropdownMenuItem
                onSelect={() => onChange("")}
                className={cn(itemClass, "flex items-center gap-2")}
              >
                <span className="flex-1 truncate">{noneLabel}</span>
                {renderCheck("")}
              </DropdownMenuItem>
            )}

            {allowAutoDetect || allowNone ? <DropdownMenuSeparator /> : null}

            {roots.map((root) => {
              const subs = childrenOf(root.id);
              const content = (
                <>
                  <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                  <span className="flex-1 truncate">{root.name}</span>
                  {renderCheck(root.id)}
                  {subs.length > 0 && (
                    <span className="ml-auto flex items-center gap-0.5 text-[10px] text-muted-foreground">
                      {subs.length}
                      <ChevronRight className="h-3 w-3" />
                    </span>
                  )}
                </>
              );

              if (subs.length === 0) {
                return (
                  <DropdownMenuItem
                    key={root.id}
                    onSelect={() => onChange(root.id)}
                    className={cn(itemClass, "flex items-center gap-2")}
                  >
                    {content}
                  </DropdownMenuItem>
                );
              }

              return (
                <DropdownMenuSub key={root.id}>
                  <DropdownMenuSubTrigger className={cn(itemClass, "flex items-center gap-2")}>
                    {content}
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent className="z-[110] w-56 rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-2xl">
                    <DropdownMenuItem
                      onSelect={() => onChange(root.id)}
                      className={cn(itemClass, "flex items-center gap-2")}
                    >
                      <Folder className="h-3.5 w-3.5 text-primary shrink-0" />
                      <span className="flex-1 truncate">Select “{root.name}” (Parent)</span>
                      {renderCheck(root.id)}
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <div className="px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Sub-modules ({subs.length})
                    </div>
                    {subs.map((sub) => (
                      <DropdownMenuItem
                        key={sub.id}
                        onSelect={() => onChange(sub.id)}
                        className={cn(itemClass, "flex items-center gap-2")}
                      >
                        <span className="text-muted-foreground">↳</span>
                        <span className="flex-1 truncate">{sub.name}</span>
                        {renderCheck(sub.id)}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              );
            })}

            <DropdownMenuSeparator />

            {creating ? (
              <div className="flex items-center gap-1.5 px-1 py-1">
                <Input
                  autoFocus
                  value={createName}
                  onChange={(e) => setCreateName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      e.stopPropagation();
                      handleCreate();
                    }
                  }}
                  placeholder="Module name"
                  className="h-7 flex-1 text-xs"
                />
                <Button
                  type="button"
                  size="sm"
                  disabled={!createName.trim()}
                  onClick={handleCreate}
                  className="h-7 shrink-0 cursor-pointer"
                >
                  Add
                </Button>
              </div>
            ) : (
              <DropdownMenuItem
                onSelect={(e) => {
                  if (onInlineCreate) {
                    e.preventDefault();
                    requestCreate();
                  } else {
                    onRequestCreate?.();
                  }
                }}
                className={cn(itemClass, "flex items-center gap-2")}
              >
                <Plus className="h-3.5 w-3.5 text-primary shrink-0" />
                <span className="truncate">+ Create New Module…</span>
              </DropdownMenuItem>
            )}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
