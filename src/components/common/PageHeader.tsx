import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * Shared responsive page header.
 *
 * The title owns a flexible, truncating region; actions sit in their own
 * shrink-0 row that stacks under the title on small screens so primary
 * actions can never overlap the heading.
 */
export function PageHeader({
  title,
  description,
  meta,
  actions,
  className,
}: {
  title: string;
  description?: ReactNode;
  meta?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4',
        className
      )}
    >
      <div className="flex min-w-0 flex-1 flex-col gap-1.5">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <h1
            className="min-w-0 max-w-full truncate text-2xl font-bold tracking-tight text-foreground"
            title={title}
          >
            {title}
          </h1>
          {meta}
        </div>
        {description ? <div className="min-w-0 text-xs text-muted-foreground">{description}</div> : null}
      </div>
      {actions ? (
        <div className="flex w-full shrink-0 flex-wrap items-center gap-2 sm:w-auto sm:flex-nowrap">
          {actions}
        </div>
      ) : null}
    </div>
  );
}
