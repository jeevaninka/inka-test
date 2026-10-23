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
import { Select } from '@/components/ui/select';
import { Layers } from 'lucide-react';
import { toast } from 'sonner';
import { bulkAddCasesToSuiteAction } from '@/app/actions/suites';

interface BulkAddToSuiteModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCaseIds: string[];
  suites: any[];
  onSuccess: () => void;
}

export function BulkAddToSuiteModal({
  open,
  onOpenChange,
  selectedCaseIds,
  suites,
  onSuccess,
}: BulkAddToSuiteModalProps) {
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>(
    suites.length > 0 ? suites[0].id : ''
  );
  const [saving, setSaving] = useState(false);

  const handleApply = async () => {
    if (!selectedSuiteId) {
      toast.error('Please select a test suite');
      return;
    }
    setSaving(true);
    try {
      const res = await bulkAddCasesToSuiteAction(selectedSuiteId, selectedCaseIds);
      toast.success(`Added ${res.count} test case(s) to suite`);
      onOpenChange(false);
      onSuccess();
    } catch (err: any) {
      toast.error(err.message || 'Failed to add cases to suite');
    } finally {
      setSaving(false);
    }
  };

  const suiteOptions = suites.map((s: any) => ({
    value: s.id,
    label: `${s.name} (${s.type || 'Custom'})`,
  }));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary">
              <Layers className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-base font-semibold">
                Add {selectedCaseIds.length} Test Case(s) to Suite
              </DialogTitle>
              <DialogDescription className="text-xs">
                Select an existing test suite to include these test cases for run execution.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3 pt-2">
          {suites.length === 0 ? (
            <div className="p-4 text-center text-xs text-muted-foreground border border-dashed rounded-xl">
              No test suites found in this project. Please create a test suite first under Suites.
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                Target Test Suite
              </label>
              <Select
                value={selectedSuiteId}
                onValueChange={setSelectedSuiteId}
                options={suiteOptions}
                className="w-full text-xs"
              />
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
            disabled={saving || !selectedSuiteId || suites.length === 0}
            className="bg-primary hover:bg-primary/90 text-primary-foreground font-semibold"
          >
            {saving ? 'Adding...' : `Add to Suite`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
