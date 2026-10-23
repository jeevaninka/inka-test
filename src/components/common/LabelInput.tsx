'use client';

import { useState } from 'react';

const LABEL_PRESETS = [
  'Smoke', 'Regression', 'Functional', 'API', 'E2E',
  'Security', 'Performance', 'Exploratory', 'Integration',
  'Acceptance', 'Usability', 'Compatibility',
];

interface LabelInputProps {
  existingLabels: string[];
  onAdd: (label: string) => void;
}

export function LabelInput({ existingLabels, onAdd }: LabelInputProps) {
  const [value, setValue] = useState('');
  const [open, setOpen] = useState(false);

  const available = LABEL_PRESETS.filter(
    (l) => !existingLabels.includes(l) && l.toLowerCase().includes(value.toLowerCase())
  );

  const handleAdd = (label: string) => {
    onAdd(label);
    setValue('');
    setOpen(false);
  };

  return (
    <div className="relative">
      <input
        className="w-full h-7 rounded-lg border border-border/50 bg-transparent px-2 text-xs"
        value={value}
        onChange={(e) => { setValue(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 200)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            if (value.trim()) handleAdd(value.trim());
          }
        }}
        placeholder="Type or select label..."
      />
      {open && (value ? available.length > 0 : LABEL_PRESETS.some((l) => !existingLabels.includes(l))) && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl glass border border-border/50 py-1 shadow-lg max-h-40 overflow-y-auto">
          {(value ? available : LABEL_PRESETS.filter((l) => !existingLabels.includes(l))).map((l) => (
            <button
              key={l}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => handleAdd(l)}
              className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors"
            >
              {l}
            </button>
          ))}
        </div>
      )}
      {value.trim() && !LABEL_PRESETS.includes(value.trim()) && (
        <div className="absolute left-0 top-full z-50 mt-1 w-full rounded-xl glass border border-border/50 py-1 shadow-lg">
          <button
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => handleAdd(value.trim())}
            className="w-full px-3 py-1.5 text-left text-xs hover:bg-muted/50 transition-colors text-primary"
          >
            Create "{value.trim()}"
          </button>
        </div>
      )}
    </div>
  );
}