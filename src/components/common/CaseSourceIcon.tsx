"use client";

import React from 'react';
import { PostmanLogo, DatadogLogo } from '@/components/icons/IntegrationLogos';
import { Cpu } from 'lucide-react';
import { getCaseAutomationSource, getCaseAutomationLabel } from '@/lib/cases/automation-source';
import { cn } from '@/lib/utils';

interface CaseSourceIconProps {
  testCase: any;
  className?: string;
  /** Hide the icon for manual cases instead of rendering nothing. */
  showExternal?: boolean;
}

/**
 * Small, non-interactive source marker for a repository case.
 * Postman and Datadog use their real brand marks; other automated cases fall
 * back to the generic automated icon.
 */
export function CaseSourceIcon({ testCase, className, showExternal = true }: CaseSourceIconProps) {
  const source = getCaseAutomationSource(testCase);
  if (source === 'manual') return null;
  if (source === 'external' && !showExternal) return null;

  const label = getCaseAutomationLabel(source);

  if (source === 'postman') {
    return (
      <span
        title={label}
        aria-label={label}
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
      >
        <PostmanLogo className="h-3.5 w-3.5" />
      </span>
    );
  }

  if (source === 'datadog') {
    return (
      <span
        title={label}
        aria-label={label}
        className={cn('inline-flex shrink-0 items-center justify-center', className)}
      >
        <DatadogLogo className="h-3.5 w-3.5" />
      </span>
    );
  }

  return (
    <span
      title={label}
      aria-label={label}
      className={cn('inline-flex shrink-0 items-center justify-center text-muted-foreground', className)}
    >
      <Cpu className="h-3.5 w-3.5" />
    </span>
  );
}
