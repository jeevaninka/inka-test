"use client";

import React from 'react';
import { Keyboard, X } from 'lucide-react';

export function ShortcutOverlay({ onClose }: { onClose: () => void }) {
  const shortcuts = [
    { key: '⌘ + V / Ctrl + V', action: 'Paste screenshot evidence into step' },
    { key: '⌘ + K / Ctrl + K', action: 'Open Global Quick Search' },
    { key: 'Esc', action: 'Return to Run Overview' },
  ];

  return (
    <div className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in-0 duration-150" onClick={onClose}>
      <div className="bg-popover border border-border/80 rounded-2xl max-w-md w-full p-5 shadow-2xl space-y-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-border/50 pb-3">
          <div className="flex items-center gap-2">
            <Keyboard className="h-5 w-5 text-primary" />
            <h3 className="font-bold text-sm">Keyboard Shortcuts</h3>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground cursor-pointer">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-2">
          {shortcuts.map((sc) => (
            <div key={sc.key} className="flex items-center justify-between text-xs py-1 border-b border-border/20 last:border-none">
              <span className="text-muted-foreground font-medium">{sc.action}</span>
              <kbd className="font-mono text-xs px-2 py-0.5 rounded bg-muted border border-border/50 font-bold text-foreground">
                {sc.key}
              </kbd>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
