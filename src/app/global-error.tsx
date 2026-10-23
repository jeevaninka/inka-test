'use client';

import { useEffect, useState } from 'react';
import { AlertTriangle, RotateCw, ArrowLeft, ChevronDown } from 'lucide-react';
import { logger } from '@/lib/logger.client';
import { ErrorCodes, normalizeError } from '@/lib/errors';

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

export default function GlobalErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string; code?: string };
  reset: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const chunkOrModuleError = isChunkOrModuleFailure(error);
  const normalized = normalizeError(error, ErrorCodes.CLIENT_RUNTIME, 'Critical application error');

  useEffect(() => {
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
      module: 'GlobalErrorBoundary',
      action: 'criticalError',
      errorCode: normalized.code,
      digest: error.digest,
      error,
    });
  }, [chunkOrModuleError, error, normalized.code, normalized.message]);

  return (
    <html lang="en">
      <body className="min-h-screen flex items-center justify-center bg-[#0b0f17] text-neutral-100 p-6 font-sans">
        <div className="max-w-md w-full rounded-2xl border border-white/10 bg-[#111622] p-7 shadow-2xl text-center space-y-5">
          <div className="w-12 h-12 rounded-2xl bg-amber-500/10 border border-amber-500/20 text-amber-400 flex items-center justify-center mx-auto">
            <AlertTriangle className="h-5 w-5" />
          </div>

          <div className="space-y-1.5">
            <h2 className="text-base font-bold text-white">
              We ran into an unexpected issue
            </h2>
            <p className="text-xs text-neutral-400 leading-relaxed max-w-sm mx-auto">
              Something interrupted loading the application. Your work is safe — reloading the page usually resolves this right away.
            </p>
          </div>

          <div className="flex items-center justify-center gap-2.5 pt-1">
            <button
              type="button"
              onClick={() => {
                if (chunkOrModuleError && typeof window !== 'undefined') {
                  window.location.reload();
                  return;
                }
                reset();
              }}
              className="h-9 px-4 rounded-xl bg-teal-500 hover:bg-teal-400 text-neutral-950 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <RotateCw className="h-3.5 w-3.5" />
              <span>Reload Page</span>
            </button>
            <button
              type="button"
              onClick={() => {
                if (typeof window !== 'undefined') {
                  window.location.href = '/workspace';
                }
              }}
              className="h-9 px-4 rounded-xl border border-white/15 bg-white/5 hover:bg-white/10 text-neutral-200 text-xs font-semibold inline-flex items-center gap-1.5 transition cursor-pointer"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Go to Workspaces</span>
            </button>
          </div>

          <div className="pt-2 border-t border-white/10">
            <button
              type="button"
              onClick={() => setShowDetails((prev) => !prev)}
              className="inline-flex items-center gap-1 text-[11px] text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
            >
              <span>{showDetails ? 'Hide technical details' : 'Show technical details'}</span>
              <ChevronDown className={`h-3 w-3 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            </button>

            {showDetails && (
              <div className="mt-2.5 p-3 rounded-xl bg-black/30 border border-white/10 text-left space-y-1 text-[11px] font-mono text-neutral-400 break-words">
                <div className="flex items-center justify-between text-[10px] text-neutral-500">
                  <span>Code: {normalized.code}</span>
                  {error.digest && <span>Digest: {error.digest}</span>}
                </div>
                <p className="text-neutral-300">{normalized.message}</p>
              </div>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
