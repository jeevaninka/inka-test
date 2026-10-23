"use client";

import React, { useState, useMemo, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Tag, Search, Trash2, Edit2, Check, X, GitMerge } from 'lucide-react';
import { toast } from 'sonner';
import {
  bulkRemoveTagAction,
  bulkRenameTagAction,
  bulkRemoveMultipleTagsAction,
  bulkMergeTagsAction,
} from '@/app/actions/cases';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { cn } from '@/lib/utils';

interface TagsManagerModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  cases: any[];
  onTagsUpdated?: (updatedCases: any[]) => void;
}

export function TagsManagerModal({
  open,
  onOpenChange,
  projectId,
  cases,
  onTagsUpdated,
}: TagsManagerModalProps) {
  const [search, setSearch] = useState('');
  const [editingTag, setEditingTag] = useState<string | null>(null);
  const [renameInput, setRenameInput] = useState('');
  const [busyTag, setBusyTag] = useState<string | null>(null);

  // Bulk selection state
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [isBulkOperating, setIsBulkOperating] = useState(false);
  const [showMergeDialog, setShowMergeDialog] = useState(false);
  const [mergeTargetTag, setMergeTargetTag] = useState('');

  // Confirmation modal state
  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    description: React.ReactNode;
    confirmLabel: string;
    onConfirm: () => void;
    variant?: 'default' | 'destructive';
  } | null>(null);

  // Track local copy of cases so updates reflect in modal without page reload
  const [localCases, setLocalCases] = useState<any[]>(cases);

  useEffect(() => {
    setLocalCases(cases);
  }, [cases]);

  // Calculate unique tags and case frequency
  const tagStats = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of localCases) {
      if (Array.isArray(c.tags)) {
        for (const t of c.tags) {
          const clean = String(t).trim().toLowerCase();
          if (clean) {
            counts.set(clean, (counts.get(clean) || 0) + 1);
          }
        }
      }
    }
    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  }, [localCases]);

  const filteredTags = useMemo(() => {
    if (!search.trim()) return tagStats;
    const q = search.trim().toLowerCase();
    return tagStats.filter((t) => t.name.includes(q));
  }, [tagStats, search]);

  // Toggle single tag selection
  const toggleSelect = (tagName: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tagName)) next.delete(tagName);
      else next.add(tagName);
      return next;
    });
  };

  // Select all filtered tags
  const toggleSelectAll = () => {
    if (selectedTags.size === filteredTags.length && filteredTags.length > 0) {
      setSelectedTags(new Set());
    } else {
      setSelectedTags(new Set(filteredTags.map((t) => t.name)));
    }
  };

  // Delete single tag with confirmation modal
  const promptDeleteTag = (t: { name: string; count: number }) => {
    setConfirmConfig({
      open: true,
      title: `Delete Tag "${t.name}"`,
      description: `This will permanently remove the tag "${t.name}" from ${t.count} test case(s). This action cannot be undone.`,
      confirmLabel: `Delete from ${t.count} Cases`,
      variant: 'destructive',
      onConfirm: async () => {
        setBusyTag(t.name);
        try {
          const res = await bulkRemoveTagAction(projectId, t.name);
          toast.success(`Removed tag "${t.name}" from ${res.count} test case(s)`);
          
          // Update local cases state without reloading the page
          const updated = localCases.map((c) => ({
            ...c,
            tags: (c.tags || []).filter((tag: string) => String(tag).trim().toLowerCase() !== t.name.toLowerCase()),
            labels: (c.labels || []).filter((l: string) => String(l).trim().toLowerCase() !== t.name.toLowerCase()),
          }));
          setLocalCases(updated);
          setSelectedTags((prev) => {
            const next = new Set(prev);
            next.delete(t.name);
            return next;
          });
          if (onTagsUpdated) onTagsUpdated(updated);
        } catch (err: any) {
          toast.error(err.message || 'Failed to delete tag');
        } finally {
          setBusyTag(null);
        }
      },
    });
  };

  // Rename single tag
  const handleRename = async (oldName: string) => {
    const newName = renameInput.trim().toLowerCase();
    if (!newName || newName === oldName) {
      setEditingTag(null);
      return;
    }
    setBusyTag(oldName);
    try {
      const res = await bulkRenameTagAction(projectId, oldName, newName);
      toast.success(`Renamed tag "${oldName}" to "${newName}" on ${res.count} test case(s)`);
      
      const updated = localCases.map((c) => ({
        ...c,
        tags: Array.from(new Set((c.tags || []).map((tag: string) => (String(tag).trim().toLowerCase() === oldName.toLowerCase() ? newName : tag)))),
        labels: (c.labels || []).map((l: string) => (String(l).trim().toLowerCase() === oldName.toLowerCase() ? newName : l)),
      }));
      setLocalCases(updated);
      setEditingTag(null);
      setRenameInput('');
      if (onTagsUpdated) onTagsUpdated(updated);
    } catch (err: any) {
      toast.error(err.message || 'Failed to rename tag');
    } finally {
      setBusyTag(null);
    }
  };

  // Bulk delete selected tags
  const promptBulkDelete = () => {
    if (selectedTags.size === 0) return;
    const selectedList = Array.from(selectedTags);
    const affectedCount = localCases.filter((c) =>
      (c.tags || []).some((t: string) => selectedTags.has(t.toLowerCase()))
    ).length;

    setConfirmConfig({
      open: true,
      title: `Delete ${selectedTags.size} Tags`,
      description: `This will permanently remove ${selectedTags.size} tags across ${affectedCount} test case(s).`,
      confirmLabel: `Delete ${selectedTags.size} Tags`,
      variant: 'destructive',
      onConfirm: async () => {
        setIsBulkOperating(true);
        try {
          const res = await bulkRemoveMultipleTagsAction(projectId, selectedList);
          toast.success(`Removed ${selectedTags.size} tags from ${res.count} test case(s)`);
          
          const updated = localCases.map((c) => ({
            ...c,
            tags: (c.tags || []).filter((t: string) => !selectedTags.has(String(t).trim().toLowerCase())),
            labels: (c.labels || []).filter((l: string) => !selectedTags.has(String(l).trim().toLowerCase())),
          }));
          setLocalCases(updated);
          setSelectedTags(new Set());
          if (onTagsUpdated) onTagsUpdated(updated);
        } catch (err: any) {
          toast.error(err.message || 'Failed to bulk delete tags');
        } finally {
          setIsBulkOperating(false);
        }
      },
    });
  };

  // Bulk merge selected tags into target tag
  const handleBulkMerge = async () => {
    const target = mergeTargetTag.trim().toLowerCase();
    if (!target) {
      toast.error('Please enter a target tag name');
      return;
    }
    const selectedList = Array.from(selectedTags);
    setIsBulkOperating(true);
    try {
      const res = await bulkMergeTagsAction(projectId, selectedList, target);
      toast.success(`Merged ${selectedTags.size} tags into "${target}" across ${res.count} test case(s)`);
      
      const mergeSet = new Set(selectedList);
      const updated = localCases.map((c) => ({
        ...c,
        tags: Array.from(new Set((c.tags || []).map((t: string) => (mergeSet.has(String(t).trim().toLowerCase()) ? target : t)))),
        labels: (c.labels || []).map((l: string) => (mergeSet.has(String(l).trim().toLowerCase()) ? target : l)),
      }));
      setLocalCases(updated);
      setSelectedTags(new Set());
      setShowMergeDialog(false);
      setMergeTargetTag('');
      if (onTagsUpdated) onTagsUpdated(updated);
    } catch (err: any) {
      toast.error(err.message || 'Failed to merge tags');
    } finally {
      setIsBulkOperating(false);
    }
  };

  const isAllSelected = filteredTags.length > 0 && selectedTags.size === filteredTags.length;

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                <Tag className="h-4 w-4" />
              </div>
              <div>
                <DialogTitle className="text-base font-semibold">Project Tags</DialogTitle>
                <DialogDescription className="text-xs">
                  Manage, search, or bulk-edit tags used across all test cases ({tagStats.length} tags discovered)
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>

          <div className="space-y-3 pt-2">
            {/* Search Input */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
              <Input
                placeholder="Search project tags..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 h-8 text-xs"
              />
            </div>

            {/* Bulk Action Strip when tags are selected */}
            {selectedTags.size > 0 && (
              <div className="flex items-center justify-between gap-2 p-2 px-3 rounded-xl bg-card border border-primary/30 shadow-xs animate-in fade-in-50 duration-150">
                <div className="flex items-center gap-2 text-xs">
                  <span className="font-mono font-bold px-1.5 py-0.2 rounded-full bg-primary/15 text-primary text-[11px]">
                    {selectedTags.size}
                  </span>
                  <span className="font-medium text-foreground">tags selected</span>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      setMergeTargetTag(Array.from(selectedTags)[0]);
                      setShowMergeDialog(true);
                    }}
                    disabled={isBulkOperating}
                    className="h-7 text-xs px-2.5 cursor-pointer flex items-center gap-1.5"
                  >
                    <GitMerge className="h-3 w-3 text-primary" />
                    <span>Merge Tags</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={promptBulkDelete}
                    disabled={isBulkOperating}
                    className="h-7 text-xs px-2.5 text-red-500 hover:text-red-600 hover:bg-red-500/10 border-red-500/25 cursor-pointer flex items-center gap-1.5"
                  >
                    <Trash2 className="h-3 w-3" />
                    <span>Delete ({selectedTags.size})</span>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setSelectedTags(new Set())}
                    className="h-7 text-xs px-2 text-muted-foreground hover:text-foreground cursor-pointer"
                  >
                    Clear
                  </Button>
                </div>
              </div>
            )}

            {/* Tags List Table Header */}
            {filteredTags.length > 0 && (
              <div className="flex items-center justify-between px-2 py-1 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider border-b border-border/30">
                <div className="flex items-center gap-2.5">
                  <Checkbox
                    checked={isAllSelected}
                    onCheckedChange={toggleSelectAll}
                    aria-label="Select all tags"
                  />
                  <span>Tag Name</span>
                </div>
                <span>Actions</span>
              </div>
            )}

            {/* Tags Scrollable List */}
            <div className="max-h-[340px] overflow-y-auto space-y-1 pr-1 divide-y divide-border/20">
              {filteredTags.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">
                  {search ? 'No tags matching search query.' : 'No tags found in this project.'}
                </div>
              ) : (
                filteredTags.map((t) => {
                  const isEditingThis = editingTag === t.name;
                  const isBusy = busyTag === t.name;
                  const isSelected = selectedTags.has(t.name);

                  return (
                    <div
                      key={t.name}
                      className={cn(
                        "flex items-center justify-between gap-2 py-1.5 px-2 rounded-lg transition-colors group text-xs",
                        isSelected ? "bg-primary/5 border border-primary/20" : "hover:bg-muted/40"
                      )}
                    >
                      {isEditingThis ? (
                        <div className="flex items-center gap-1.5 flex-1 mr-2">
                          <Input
                            value={renameInput}
                            onChange={(e) => setRenameInput(e.target.value)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') handleRename(t.name);
                              if (e.key === 'Escape') setEditingTag(null);
                            }}
                            className="h-7 text-xs font-mono"
                            autoFocus
                          />
                          <button
                            type="button"
                            onClick={() => handleRename(t.name)}
                            disabled={isBusy}
                            className="p-1 text-emerald-600 hover:bg-emerald-500/10 rounded cursor-pointer"
                            title="Save Rename"
                          >
                            <Check className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => setEditingTag(null)}
                            className="p-1 text-muted-foreground hover:bg-muted rounded cursor-pointer"
                            title="Cancel"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2.5 min-w-0 flex-1">
                          <Checkbox
                            checked={isSelected}
                            onCheckedChange={() => toggleSelect(t.name)}
                            aria-label={`Select tag ${t.name}`}
                          />
                          <span className="font-mono text-xs font-semibold text-foreground/90 truncate select-all">
                            {t.name}
                          </span>
                          <span className="text-[10px] font-mono px-1.5 py-0.2 rounded-full bg-muted text-muted-foreground font-semibold shrink-0">
                            {t.count} {t.count === 1 ? 'case' : 'cases'}
                          </span>
                        </div>
                      )}

                      {!isEditingThis && (
                        <div className="flex items-center gap-1 shrink-0">
                          <button
                            type="button"
                            onClick={() => {
                              setEditingTag(t.name);
                              setRenameInput(t.name);
                            }}
                            className="p-1 text-muted-foreground hover:text-foreground rounded hover:bg-muted transition-colors cursor-pointer"
                            title="Rename tag"
                          >
                            <Edit2 className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => promptDeleteTag(t)}
                            disabled={isBusy}
                            className="p-1 text-muted-foreground hover:text-destructive rounded hover:bg-destructive/10 transition-colors cursor-pointer"
                            title="Delete tag from all cases"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Confirmation Modal for Single or Bulk Delete */}
      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => !open && setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant || 'destructive'}
          onConfirm={confirmConfig.onConfirm}
        />
      )}

      {/* Merge Tags Modal */}
      {showMergeDialog && (
        <Dialog open={showMergeDialog} onOpenChange={setShowMergeDialog}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
                  <GitMerge className="h-4 w-4" />
                </div>
                <div>
                  <DialogTitle className="text-base font-semibold">Merge {selectedTags.size} Tags</DialogTitle>
                  <DialogDescription className="text-xs">
                    Combine selected tags into a single unified tag name across all test cases.
                  </DialogDescription>
                </div>
              </div>
            </DialogHeader>

            <div className="space-y-3 pt-2">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Target Tag Name
                </label>
                <Input
                  value={mergeTargetTag}
                  onChange={(e) => setMergeTargetTag(e.target.value)}
                  placeholder="e.g. cancellation"
                  className="h-8 text-xs font-mono"
                  autoFocus
                />
              </div>

              <div className="text-xs text-muted-foreground">
                <span className="font-semibold block mb-1">Tags to be merged into "{mergeTargetTag || '...'}"</span>
                <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto p-1.5 rounded-lg bg-muted/40 border">
                  {Array.from(selectedTags).map((t) => (
                    <span key={t} className="font-mono text-[11px] px-1.5 py-0.5 rounded bg-card border text-foreground/90">
                      {t}
                    </span>
                  ))}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-3 border-t">
              <Button variant="outline" size="sm" onClick={() => setShowMergeDialog(false)} disabled={isBulkOperating}>
                Cancel
              </Button>
              <Button
                size="sm"
                onClick={handleBulkMerge}
                disabled={isBulkOperating || !mergeTargetTag.trim()}
                className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
              >
                {isBulkOperating ? 'Merging...' : `Merge into "${mergeTargetTag || 'tag'}"`}
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </>
  );
}
