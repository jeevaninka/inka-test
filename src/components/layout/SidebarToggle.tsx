"use client";

import { useEffect } from 'react';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SidebarToggleProps {
  isCollapsed: boolean;
  onToggle: () => void;
  className?: string;
}

export function SidebarToggle({ isCollapsed, onToggle, className }: SidebarToggleProps) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'b') {
        e.preventDefault();
        onToggle();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onToggle]);

  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose;
  const tooltipText = isCollapsed ? `Expand sidebar (${typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})` : `Collapse sidebar (${typeof navigator !== 'undefined' && navigator.platform.includes('Mac') ? '⌘B' : 'Ctrl+B'})`;

  return (
    <Tooltip content={tooltipText} side="right">
      <button
        onClick={onToggle}
        className={cn(
          "w-8 h-8 flex items-center justify-center rounded-lg transition-colors duration-150 cursor-pointer",
          "text-slate-500 hover:text-teal-500 hover:bg-[#E6F3F0]",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500 focus-visible:ring-offset-0",
          className
        )}
        aria-label={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
      >
        <Icon className="h-[18px] w-[18px]" strokeWidth={1.5} />
      </button>
    </Tooltip>
  );
}
