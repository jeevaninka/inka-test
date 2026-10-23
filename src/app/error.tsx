'use client';

import { useEffect } from 'react';
import { AlertTriangle, RotateCw, ArrowLeft } from 'lucide-react';
import { logger } from '@/lib/logger.client';
import { ErrorCodes, normalizeError } from '@/lib/errors';
import { Button } from '@/components/ui/button';

function isChunkOrModuleFailure(err: unknown): boolean {
  const msg = (err as any)?.message || String(err || '');
  return (
    msg.includes('Failed to load chunk') ||
    msg.includes('ChunkLoadError') ||
    msg.includes('Loading chunk') ||
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('module factory is not available') ||
    msg.includes('was instantiated because it was required') ||
    msg.includes('is not defined')
  );
}

export default function AppErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
}) {
  const chunkOrModuleError = isChunkOrModuleFailure(error);
  const normalized = normalizeError(
    error,
    ErrorCodes.CLIENT_RUNTIME,
    'Something went wrong while rendering this page'
  );

  useEffect(() => {
    // Auto-recover once on transient chunk/HMR load failure
    if (chunkOrModuleError && typeof window !== 'undefined') {
      try {
        const key = 'inka_chunk_reload_ts';
        const lastReload = Number(sessionStorage.getItem(key) || '0');
        const now = Date.now();
        if (now - lastReload > 15000) {
          sessionStorage.setItem(key, String(now));
          window.location.reload();
          return;
        }
      } catch {
        // Ignore sessionStorage errors
      }
    }

    logger.error(normalized.message, {
      module: 'ErrorBoundary',
      action: 'renderError',
      errorCode: normalized.code,
      digest: error.digest,
      error,
    });
  }, [chunkOrModuleError, error, normalized.code, normalized.message]);

  const handleRetry = () => {
    if (chunkOrModuleError && typeof window !== 'undefined') {
      window.location.reload();
      return;
    }
    reset();
  };

  return (
    <div className="min-h-[70vh] flex items-center justify-center p-6">
      <div className="max-w-md w-full rounded-2xl border border-border/60 bg-card p-7 shadow-xl text-center space-y-5 animate-in fade-in zoom-in-95 duration-200">
        {/* Calm Icon Header */}
        <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
          <AlertTriangle className="h-5 w-5" />
        </div>

        {/* User-Friendly Copy */}
        <div className="space-y-1.5">
          <h2 className="text-base font-bold text-foreground">
            We ran into an unexpected issue
          </h2>
          <p className="text-xs text-muted-foreground leading-relaxed max-w-sm mx-auto">
            Your test cases and work are safe.
          </p>
        </div>

        {/* Standard Action Buttons */}
        <div className="flex items-center justify-center gap-2.5 pt-1">
          <Button
            type="button"
            onClick={handleRetry}
            className="h-9 px-4 rounded-xl text-xs font-semibold gap-1.5 cursor-pointer"
          >
            <RotateCw className="h-3.5 w-3.5" />
            <span>Reload Page</span>
          </Button>
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.href = '/workspace';
              }
            }}
            className="h-9 px-4 rounded-xl text-xs font-semibold gap-1.5 cursor-pointer"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Go to Workspaces</span>
          </Button>
        </div>

      </div>
    </div>
  );
}
