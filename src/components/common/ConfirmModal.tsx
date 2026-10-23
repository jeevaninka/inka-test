"use client";

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface ConfirmModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  variant?: 'default' | 'destructive';
  disabled?: boolean;
  /**
   * When set, the user must type this exact value (case-sensitive) before the
   * confirm button is enabled. Use "DELETE" for destructive actions.
   */
  requireTypedConfirmation?: string;
}

export function ConfirmModal({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  variant = 'default',
  disabled = false,
  requireTypedConfirmation,
}: ConfirmModalProps) {
  const [typedValue, setTypedValue] = useState('');

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setTypedValue('');
    onOpenChange(nextOpen);
  };

  const typedConfirmationMatches =
    !requireTypedConfirmation || typedValue === requireTypedConfirmation;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange} className="z-[120]">
      <DialogContent onClose={() => handleOpenChange(false)} className="z-[120]">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {typeof description === 'string' ? (
            <DialogDescription>{description}</DialogDescription>
          ) : (
            <div className="text-sm text-muted-foreground">{description}</div>
          )}
        </DialogHeader>
        {requireTypedConfirmation && (
          <div className="space-y-2 py-2">
            <label
              htmlFor="confirm-typed-value"
              className="text-xs font-medium text-muted-foreground"
            >
              Type{' '}
              <span className="font-mono font-bold text-destructive">
                {requireTypedConfirmation}
              </span>{' '}
              to confirm
            </label>
            <Input
              id="confirm-typed-value"
              value={typedValue}
              onChange={(e) => setTypedValue(e.target.value)}
              placeholder={requireTypedConfirmation}
              autoComplete="off"
              autoCorrect="off"
              spellCheck={false}
              className="font-mono"
            />
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant={variant === 'destructive' ? 'destructive' : 'default'}
            disabled={disabled || !typedConfirmationMatches}
            onClick={() => {
              setTypedValue('');
              onConfirm();
              handleOpenChange(false);
            }}
          >
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
