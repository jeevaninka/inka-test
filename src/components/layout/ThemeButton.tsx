'use client';

import { Palette, Check } from 'lucide-react';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { useTheme, type Theme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface ThemeOption {
  id: Theme;
  label: string;
  dotClass: string;
}

const THEMES: ThemeOption[] = [
  {
    id: 'cyber-teal',
    label: 'Cyber Teal',
    dotClass: 'bg-[#29CCB1] border border-teal-400/40 shadow-xs',
  },
  {
    id: 'graphite',
    label: 'Graphite',
    dotClass: 'bg-[#27272A] border border-zinc-500/60 shadow-xs',
  },
  {
    id: 'white',
    label: 'White',
    dotClass: 'bg-white border border-zinc-300 dark:border-zinc-500 shadow-xs',
  },
];

export function ThemeButton() {
  const { theme, setTheme } = useTheme();
  const [open, setOpen] = useState(false);

  const handleSelectTheme = (id: Theme) => {
    setTheme(id);
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground hover:text-foreground"
          title="Theme"
        >
          <Palette className="h-4 w-4" />
        </Button>
      </PopoverTrigger>

      <PopoverContent align="end" className="w-44 p-1 rounded-xl border border-border/80 bg-popover shadow-xl">
        <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider block px-2.5 py-1">
          Theme
        </span>
        <div className="space-y-0.5">
          {THEMES.map((t) => {
            const isSelected = theme === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => handleSelectTheme(t.id)}
                className={cn(
                  'w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-left text-xs transition-colors cursor-pointer select-none',
                  isSelected
                    ? 'bg-muted/80 text-foreground font-medium'
                    : 'text-muted-foreground hover:text-foreground hover:bg-muted/40'
                )}
              >
                <div className="flex items-center gap-2.5">
                  <span className={cn('w-3.5 h-3.5 rounded-full shrink-0', t.dotClass)} />
                  <span className="text-xs leading-none">{t.label}</span>
                </div>
                {isSelected && (
                  <Check className="h-3.5 w-3.5 text-primary shrink-0" />
                )}
              </button>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
