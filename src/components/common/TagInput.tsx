'use client';

import { useState } from 'react';

interface TagInputProps {
  onAdd: (tag: string) => void;
}

export function TagInput({ onAdd }: TagInputProps) {
  const [value, setValue] = useState('');

  const handleAdd = () => {
    const tag = value.trim();
    if (!tag) return;
    onAdd(tag);
    setValue('');
  };

  return (
    <div className="flex gap-1">
      <input
        className="flex-1 h-7 rounded-lg border border-border/50 bg-transparent px-2 text-xs"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAdd(); } }}
        placeholder="Add tag..."
      />
      <button
        onClick={handleAdd}
        className="text-xs px-2 rounded-lg bg-primary text-primary-foreground"
      >
        +
      </button>
    </div>
  );
}