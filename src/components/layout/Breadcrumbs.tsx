"use client";

import { useRouter } from 'next/navigation';
import { ChevronRight, Home } from 'lucide-react';
import { cn } from '@/lib/utils';

interface BreadcrumbItem {
  label: string;
  href?: string;
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[];
  className?: string;
}

export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const router = useRouter();
  return (
    <nav className={cn('flex items-center text-sm', className)}>
      <a
        href="/projects"
        onClick={(e) => {
          e.preventDefault();
          router.push('/projects');
        }}
        className="flex items-center text-muted-foreground hover:text-foreground"
      >
        <Home className="h-4 w-4" />
      </a>
      {items.map((item, index) => (
        <div key={index} className="flex items-center">
          <ChevronRight className="mx-1 h-3.5 w-3.5 text-muted-foreground/60" />
          {item.href ? (
            <a
              href={item.href}
              onClick={(e) => {
                e.preventDefault();
                router.push(item.href!);
              }}
              className="text-muted-foreground hover:text-foreground font-semibold text-xs transition-colors cursor-pointer"
            >
              {item.label}
            </a>
          ) : (
            <span className="text-foreground font-semibold text-xs">{item.label}</span>
          )}
        </div>
      ))}
    </nav>
  );
}