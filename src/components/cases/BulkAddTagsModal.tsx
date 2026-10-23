"use client";

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Tag, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { bulkAddTagsAction } from '@/app/actions/cases';

interface BulkAddTagsModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCaseIds: string[];
  allExistingTags: string[];
  onSuccess: () => void;
}

export function BulkAddTagsModal({
  open,
  onOpenChange,
  selectedCaseIds,
  allExistingTags,
  onSuccess,
}: BulkAddTagsModalProps) {
  const [tags, setTags] = useState<string[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [saving, setSaving] = useState(false);

  const addTag = (val: string) => {
    const clean = val.trim().toLowerCase();
    if (!clean) return;
    if (!tags.includes(clean)) {
      setTags((prev) => [...prev, clean]);
    }
    setInputValue('');
  };

  const removeTag = (tagToRemove: string) => {
    setTags((prev) => prev.filter((t) => t !== tagToRemove));
  };

  const handleApply = async () => {
    if (tags.length === 0) {
      toast.error('Please add at least one tag');
      return;
    }
    setSaving(true);
    try {
      const res = await bulkAddTagsAction(selectedCaseIds, tags);
      toast.success(`Added ${tags.length} tag(s) to ${res.count} test case(s)`);
      setTags([]);
      setInputValue('');
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add tags');
    } finally {
      setSaving(false);
    }
  };

  // Filter suggestions to those not already added
  const unusedSuggestions = allExistingTags
    .filter((s) => !tags.includes(s.toLowerCase()))
    .slice(0, 10);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <Tag className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Add Tags to {selectedCaseIds.length} Test Case(s)
              </DialogTitle>
              <DialogDescription className="text-xs">
                Type tags or click suggestions below. Existing tags will not be duplicated.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {/* Tag Input Field */}
          <div className="flex gap-1.5">
            <input
              type="text"
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ',') {
                  e.preventDefault();
                  addTag(inputValue);
                }
              }}
              placeholder="Type tag name and press Enter..."
              className="flex-1 h-8 rounded-lg border border-border/60 bg-background px-2.5 text-xs focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <Button
              type="button"
              size="sm"
              onClick={() => addTag(inputValue)}
              disabled={!inputValue.trim()}
              className="h-8 px-2.5 text-xs font-medium cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>

          {/* Selected Tags Pills */}
          {tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-muted/30 border border-border/40 min-h-[36px]">
              {tags.map((t) => (
                <span
                  key={t}
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-primary/15 text-primary text-xs font-mono font-semibold"
                >
                  {t}
                  <button
                    type="button"
                    onClick={() => removeTag(t)}
                    className="hover:text-destructive transition-colors ml-0.5"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          )}

          {/* Existing Tag Suggestions */}
          {unusedSuggestions.length > 0 && (
            <div className="space-y-1">
              <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block">
                Suggested Project Tags
              </span>
              <div className="flex flex-wrap gap-1">
                {unusedSuggestions.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => addTag(s)}
                    className="px-2 py-0.5 rounded-md border border-border/50 bg-background hover:bg-muted text-foreground/80 hover:text-foreground text-[11px] font-mono transition-colors cursor-pointer"
                  >
                    + {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => onOpenChange(false)}
            disabled={saving}
          >
            Cancel
          </Button>
          <Button
            size="sm"
            onClick={handleApply}
            disabled={saving || tags.length === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            {saving ? 'Applying...' : `Add to ${selectedCaseIds.length} Cases`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
