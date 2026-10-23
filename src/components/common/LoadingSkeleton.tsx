"use client";

import { cn } from '@/lib/utils';

interface LoadingSkeletonProps {
  className?: string;
  count?: number;
}

export function LoadingSkeleton({ className, count = 1 }: LoadingSkeletonProps) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'skeleton-shimmer rounded-lg',
            className
          )}
        />
      ))}
    </>
  );
}

export function TableRowSkeleton({ columns = 5 }: { columns?: number }) {
  return (
    <tr className="border-b">
      {Array.from({ length: columns }).map((_, i) => (
        <td key={i} className="p-2">
          <LoadingSkeleton className="h-4 w-full" />
        </td>
      ))}
    </tr>
  );
}

export function CardSkeleton() {
  return (
    <div className="rounded-lg border bg-card p-4">
      <LoadingSkeleton className="h-4 w-1/3 mb-2" />
      <LoadingSkeleton className="h-8 w-1/2 mb-4" />
      <LoadingSkeleton className="h-16 w-full" />
    </div>
  );
}