'use client';

import { Link2, AlertTriangle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ReusableStepBadgeProps {
  isReusable: boolean;
  isOutdated?: boolean;
}

export function ReusableStepBadge({ isReusable, isOutdated }: ReusableStepBadgeProps) {
  if (!isReusable && !isOutdated) return null;

  return (
    <div className="flex items-center gap-1.5">
      {isReusable && (
        <span
          className={cn(
            'inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full',
            isOutdated
              ? 'bg-amber-500/20 text-amber-600 border border-amber-400/30'
              : 'bg-blue-500/20 text-blue-600 border border-blue-400/30'
          )}
          title="This step is linked to a reusable step"
        >
          <Link2 className="h-3 w-3" />
          Shared
        </span>
      )}
      {isOutdated && (
        <span
          className="inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-red-500/20 text-red-600 border border-red-400/30"
          title="The source reusable step has been updated. Click to update from source."
        >
          <AlertTriangle className="h-3 w-3" />
          Outdated
        </span>
      )}
    </div>
  );
}