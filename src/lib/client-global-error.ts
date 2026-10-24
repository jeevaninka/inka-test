'use client';

import { useEffect } from 'react';
import { logger } from '@/lib/logger.client';
import { ErrorCodes, normalizeError } from '@/lib/errors';

export function ClientGlobalErrorHandler() {
  useEffect(() => {
    const handleError = (event: ErrorEvent | string) => {
      const message = typeof event === 'string' ? event : event?.message || 'Uncaught error';
      const filename = typeof event === 'object' && event ? event.filename : undefined;
      const lineno = typeof event === 'object' && event ? event.lineno : undefined;
      const colno = typeof event === 'object' && event ? event.colno : undefined;

      const normalized = normalizeError(
        typeof event === 'string' ? new Error(message) : (event.error || message),
        ErrorCodes.CLIENT_RUNTIME,
        'Uncaught client error'
      );

      logger.error(`Client error: ${normalized.message}`, {
        module: 'ClientGlobalError',
        action: 'windowError',
        errorCode: normalized.code,
        filename,
        lineno,
        colno,
        error: typeof event === 'object' && event ? event.error : undefined,
        skipRemote: false,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      const reason = event.reason;
      const normalized = normalizeError(
        reason instanceof Error ? reason : new Error(String(reason ?? 'Unhandled promise rejection')),
        ErrorCodes.CLIENT_RUNTIME,
        'Unhandled promise rejection'
      );

      logger.error(`Unhandled rejection: ${normalized.message}`, {
        module: 'ClientGlobalError',
        action: 'unhandledRejection',
        errorCode: normalized.code,
        error: reason instanceof Error ? reason : reason,
        skipRemote: false,
      });
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('error', handleError as EventListener);
      window.addEventListener('unhandledrejection', handleUnhandledRejection as EventListener);

      return () => {
        window.removeEventListener('error', handleError as EventListener);
        window.removeEventListener('unhandledrejection', handleUnhandledRejection as EventListener);
      };
    }
  }, []);

  return null;
}

export function initClientErrorTracking() {
  if (typeof window !== 'undefined') {
    // No-op retained for callers; actual wiring happens in ClientGlobalErrorHandler via useEffect
  }
}
