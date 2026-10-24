# End-to-End Logging Plan

## Goal
Ensure all API endpoints and frontend client code have proper structured logging across the entire application, end to end.

## Current State

### Logging infrastructure (already exists)
- `src/lib/logger.ts` — structured server logger (JSON to stdout/stderr, CloudWatch-compatible), with `runLoggedAction` wrapper
- `src/lib/logger.client.ts` — structured client logger, forwards errors to `/api/v1/logs`
- `src/lib/apiHandler.ts` — `createApiHandler` wrapper that logs request start/complete/error automatically with `x-request-id` tracing
- `src/lib/errors.ts` — `AppError`, `ErrorCodes`, `normalizeError`
- `src/app/api/v1/logs/route.ts` — ingests client-side error events

### Routes using `createApiHandler` (automatic request logging) ✅
- `api/v1/notifications/route.ts` (GET)
- `api/v1/cases/[caseId]/route.ts` (GET)
- `api/v1/runs/[runId]/results/[resultId]/details/route.ts` (GET)
- `api/v1/projects/[projectId]/reviews/route.ts` (GET)
- `api/v1/projects/[projectId]/badges/route.ts` (GET)
- `api/v1/projects/[projectId]/defects/route.ts` (GET)
- `api/v1/workspaces/[workspaceSlug]/route.ts` (GET)
- `api/v1/workspaces/active/route.ts` (GET)

### Routes with raw handlers and manual logging (mixed coverage)
- `api/health/route.ts` ✅ has logging
- `api/v1/runs/[runId]/results/route.ts` — GET via createApiHandler ✅, PATCH manual ✅
- `api/v1/internal/execution/tick/route.ts` ✅
- `api/v1/logs/route.ts` ✅
- `api/v1/projects/route.ts` ✅
- `api/v1/attachments/upload/route.ts` ✅
- `api/v1/attachments/[id]/route.ts` ✅
- `api/v1/attachments/link/route.ts` ✅
- `api/v1/attachments/complete/route.ts` ✅
- `api/v1/attachments/[id]/download/route.ts` ✅
- `api/v1/projects/[projectId]/webhooks/incoming/route.ts` ✅
- `api/v1/projects/[projectId]/webhooks/pm-tool/route.ts` ✅ (delegates to incoming)
- `api/v1/runs/[runId]/route.ts` ✅ (redirect route)
- `api/projects/[projectId]/variables/[key]/usage/route.ts` ✅

### Routes with GAPS
1. **`api/v1/projects/[projectId]/runs/postman/route.ts`** — catch block returns `apiErrorResponse` with NO `logger.error` call (line 192-198)
2. **`api/v1/runs/[runId]/events/route.ts`** — SSE endpoint, NO logging at all (no request start, auth, error, or stream lifecycle)
3. **`api/v1/workspaces/[workspaceSlug]/webhooks/incoming/route.ts`** — error response at line 288 missing `requestId`; no success log on completion
4. **`api/steps/[stepId]/image/route.ts`** — only has a `logger.warn` in catch; no request-start/complete logging, no requestId in error context
5. **`api/auth/[...nextauth]/route.ts`** — NextAuth handler, no logging wrapper

### Frontend / Client gaps
6. **No global unhandled rejection handler** — `window.onunhandledrejection` and `window.onerror` not wired to client logger
7. **No API request/response logging interceptor** — client API calls via `apiClient.ts` already integrate with `clientLogger` (confirmed), but verify coverage is complete across all fetch call sites

## Plan

### Task 1: Fix `api/v1/projects/[projectId]/runs/postman/route.ts`
Add `import { logger } from '@/lib/logger'` and `logger.error` in the catch block with requestId, projectId, errorCode, and error context. Match the pattern used in other raw handlers.

### Task 2: Add logging to `api/v1/runs/[runId]/events/route.ts`
Add structured logging for:
- Request start (auth check, runId, userId)
- Auth failures (warn)
- Permission failures (warn)
- Stream open/close (info)
- Errors in snapshot building (warn)
- SSE stream errors (error)

### Task 3: Fix `api/v1/workspaces/[workspaceSlug]/webhooks/incoming/route.ts`
- Add `requestId` to the final `apiErrorResponse` call (line 288)
- Add `logger.info` on successful webhook processing (mirror the project webhook route at lines 203-213)
- Add `logger.debug` at request start

### Task 4: Improve `api/steps/[stepId]/image/route.ts`
- Add `requestId` extraction and pass through all `apiErrorResponse` / `NextResponse.json` error calls
- Add `logger.debug` at request start and `logger.info` on successful image serve
- Add `logger.error` in the catch block (currently only `logger.warn`)

### Task 5: Add logging to `api/auth/[...nextauth]/route.ts`
Wrap the NextAuth handler or add logging callbacks for sign-in/sign-out/error events. At minimum, log errors through the NextAuth `events` or `logger` in auth.config.

### Task 7: Frontend — Global unhandled error/rejection handler
Create `src/lib/client-global-error.ts` that wires:
- `window.onerror`
- `window.onunhandledrejection`
- React `ErrorBoundary` integration already exists via `error.tsx`/`global-error.tsx`
Export an `initClientErrorTracking()` function to call from layout or a root client component.

### Task 8: Frontend — API request/response logging
Verify `src/lib/apiClient.ts` (confirmed exists and integrates with `clientLogger`) covers all client fetch call sites with request/response logging (method, URL, status, duration, errors).

### Task 9: Verify server actions use `runLoggedAction`
Spot-check key server actions in `src/app/actions/*.ts` to confirm they use `runLoggedAction` for structured logging where appropriate. Add missing wrappers to high-traffic actions (createRun, updateRunResult, raiseDefect, etc.) if absent.

## Resolved (no action needed)
- `src/app/(main)/p/[slug]/layout.tsx` — confirmed Server Component; server `logger` import at line 10 is correct
- `src/lib/apiClient.ts` — confirmed exists and already integrates with `clientLogger` for request/response observability

## Validation
- `pnpm run typecheck` passes
- `pnpm run lint` passes
- `pnpm run build` passes
- All routes that previously lacked logging now emit structured JSON logs with `requestId`, `module`, `action`, `durationMs`, and `errorCode` on failure