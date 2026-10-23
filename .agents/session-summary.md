# Current Session — Execution Board (Run Deck + Execution Console)

## Goal
- Build a unified single-page **Command Center Execution Board** for test runs — combining full-width run deck table (triage) and full-width execution console (inline pass/fail, step notes, attachments, defects) into one route, toggled via `?resultId=` URL param. No navigation to second screens.

## Constraints & Preferences
- **Split-pane rejected by user**: Final design is two-mode full-page — Run Deck (full-width table) ↔ Execution Console (full-width execution view), not a 48/52 split
- **Deck mode**: Full-width table with suite group headers, checkbox column, search, filter pills, bulk actions, 3-dot menu per row
- **Execution mode**: Full-width steps timeline, per-step pass/fail/blocked/skip/invalid chips, per-step notes textarea, per-step attach button, per-step defect creation button (for fail/blocked)
- **Overall result block at top** (not bottom) — above the tabs section
- **Case header**: shows displayId, priority, status, author ("Created by"), assignee
- **Tabs below result**: Details (description, metadata), Steps (pre-conditions at top, steps timeline, post-conditions at bottom), Run History (previous executions table — placeholder for now)
- **Case displayId (e.g. INK-3) shown on right side** of top bar
- Steps fetched from `TestCaseStep` DB table (NOT `currentCase.steps` JSON)
- INVALID status fully supported
- No auto-pass — marking all steps pass does NOT mark overall case pass
- Step results stored in expanded `step_results` JSON: `{ "order": { status, note, attachments[], defectId } }`
- Notes auto-save on blur; step notes save with 500ms debounce
- Keyboard shortcuts: `←`/`→` navigate cases, `1`-`5` mark overall status, `Esc` back to deck
- Bulk actions: assign, unassign, bypass all pending (confirmation required)
- Rerun requires confirmation dialog before reset
- Unassigned cases shown directly (no accordion) in the deck table
- Copy link button replaced with LinkIcon (no text)
- Premium glassmorphism dark UI
- Mobile: same two-mode approach, slide transitions

## Progress
### Done
- **Schema changes** (`prisma db push`): INVALID in `ResultStatus`; `source`/`trigger_ref` on `TestRun`; `source`/`automation_log` on `RunResult`; `api_secret` on `Project`
- **Server actions** (`runs.ts`): `updateRunResultAction` (accepts INVALID + source + automationLog); `getRunResultsAction` (returns source/automationLog); `finishRunAction` (fires webhook); `resetRunResultsAction` (resets automation fields); `createTestRunAction` (accepts source/triggerRef); `deleteRunResultAction`; `bulkUpdateRunResultStatusAction` (bypass pending)
- **Automation API route**: `src/app/api/v1/runs/[runId]/results/route.ts` — PATCH with API key auth
- **API secret actions** (`projects.ts`): `getApiSecretAction`, `generateApiSecretAction`, `regenerateApiSecretAction`
- **ResultStatusBadge**: `invalid` config added (purple, `Ban` icon)
- **`ResultStatus` type**: includes `'invalid'`
- **Report page enhancements**: filter tabs, copy report link, source column, defect link fix
- **Settings integrations page**: API secret UI
- **Desktop + Mobile mockup HTMLs**: provided for reference
- **`mapPrismaSuiteToMock` fixed** in `layout.tsx`: now includes `suite_cases` (was missing — caused "0 cases" in run wizard and "No suites with cases" bug)
- **Stepper alignment fixed** in `runs/new/page.tsx`: each step circle + label grouped in vertical flex column with consistent width
- **Deleted execute page**: `execute/[resultId]/page.tsx` directory removed entirely
- **Run Deck + Execution Console fully rewritten** in `runs/[runId]/page.tsx` (~1274 lines) with two-mode full-page architecture
- **Run Deck bugs fixed**: Copy button → LinkIcon; Rerun now shows confirmation dialog; Unassigned accordion removed (always visible, no collapse)
- **Execution Console UI overhaul COMPLETE**: tabs (Details/Steps/Run History), overall result block at top (above tabs), case author + assignee shown, pre-conditions above steps / post-conditions below steps, per-step attachment button, per-step defect creation button for fail/blocked states, case displayId on right side of top bar, attach evidence button with file upload handler, no TypeScript errors

### In Progress
- (all Execution Console work complete — none in progress)

### Blocked
- (none)

## Key Decisions
- **Two-mode full-page** (not split-pane): Run Deck (no `?resultId=`) ↔ Execution Console (`?resultId=RES-123`), toggled via `useSearchParams` on same route `/runs/[runId]` — user explicitly rejected split-pane layout
- **Execute page deleted**: `execute/[resultId]/page.tsx` directory removed entirely — all execution happens on the unified page
- **Step results JSON expanded**: `Record<string, { status, note?, attachments?, defectId? }>` — backward-compatible with old string-format data
- **Step-level attachments**: Use existing S3 upload infra via `/api/v1/attachments/upload` → presigned PUT → `/api/v1/attachments/complete`. Attachments linked with `entityType: "run_result"` + `entityId: runResultId`.
- **No auto-pass**: Tester controls overall result manually, even if all steps pass
- **Pre-conditions above steps, post-conditions below** — inline in the Steps tab
- **Content reorder**: Overall result buttons + notes + evidence moved to top of page (above tabs), not at bottom
- **Case metadata**: Author ("Created by") and assignee shown directly under case title
- **Case ID positioned right** in the top bar (not left)
- **Bulk bypass**: Updates only PENDING cases to PASS
- **Rerun**: Requires confirmation dialog before resetting results
- **Shared data**: Both modes share same `results` state fetched once in parent component; only the presentation changes
- **File upload**: Handled by hidden `<input type="file">` ref; files uploaded via /api/v1/attachments/upload → presigned S3 PUT → /api/v1/attachments/complete
- **Members access**: Destructured from `useProjectData()` in main controller, passed as prop to both RunDeck and ExecutionConsole

## Next Steps
1. **Build + test**: verify all changes compile and run correctly — DONE (0 TS errors)
2. **Polish**: verify suite_cases fix propagates to run wizard, stepper alignment is correct, all keyboard shortcuts work
3. **Test mobile responsive**: slide transitions between deck and console on mobile
4. **Run History tab**: populate with actual previous run data when API endpoint available

## Critical Context
- `getTestCaseStepsAction` returns `TestCaseStep[]` from DB — correct source for step data. Fields: `order`, `step`, `expected_result`, `data`, `image_url`, `reusable_step_id`, `is_outdated`.
- `RunResult.step_results` JSON — currently stores `{"1":"pass"}` (string values). New expanded structure: `{"1":{"status":"pass","note":"...","attachments":[...],"defectId":"..."}}`. Code handles both formats on read.
- `RunResultStep` model exists in schema but is **NOT used anywhere** — all step results stored in JSON blob.
- Attachment upload flow: `POST /api/v1/attachments/upload` (returns `uploadUrl`, `attachmentId`, `key`) → PUT file to `uploadUrl` → `PATCH /api/v1/attachments/complete`.
- `ResultStatus` enum: `PENDING | PASS | FAIL | BLOCKED | SKIP | INVALID`
- `getTestSuites` in `src/lib/dal/projects.ts` already includes `{ suite_cases: { include: { test_case: true } } }` — fix was in `mapPrismaSuiteToMock` which was stripping `suite_cases`
- `layout.tsx` uses `function` declarations (hoisted) so `mapPrismaCaseToMock` is available when called from `mapPrismaSuiteToMock`
- `useSearchParams()` is a client-side hook — page must be `"use client"`; reading `searchParams.get('resultId')` drives the mode switch
- page.tsx is currently ~1274 lines, 0 TypeScript errors after compilation

## Relevant Files
- `src/app/(main)/p/[slug]/runs/[runId]/page.tsx`: COMPLETE REWRITE as two-mode full-page (Run Deck + Execution Console). Execution Console now has tabs, attachments, repositioned overall result block at top, pre/post conditions, author/assignee display, displayId on right, per-step attachments and defects. 0 TS errors.
- ~~`src/app/(main)/p/[slug]/runs/[runId]/execute/[resultId]/page.tsx`: DELETED~~ — no longer needed
- `src/app/(main)/p/[slug]/layout.tsx`: `mapPrismaSuiteToMock` fixed to include `suite_cases` (fixes run wizard "0 cases" bug)
- `src/app/(main)/p/[slug]/runs/new/page.tsx`: Stepper alignment fixed (circle + label grouped in vertical columns)
- `src/app/(main)/p/[slug]/runs/[runId]/report/page.tsx`: Enhanced (unchanged in latest pass)
- `src/app/actions/runs.ts`: Updated — includes `deleteRunResultAction`, `bulkUpdateRunResultStatusAction`
- `src/app/actions/projects.ts`: API secret actions (unchanged)
- `src/app/api/v1/runs/[runId]/results/route.ts`: Automation endpoint (unchanged)
- `src/app/api/v1/attachments/upload/route.ts`: S3 upload flow (used for step attachments)
- `src/app/api/v1/attachments/complete/route.ts`: Attachment completion (used for step attachments)
- `src/lib/dal/projects.ts`: `getTestSuites` includes `suite_cases` with nested `test_case` (already correct)
- `prisma/schema.prisma`: INVALID enum, source/trigger_ref, api_secret (unchanged)
- `src/components/common/ResultStatusBadge.tsx`: Updated with `invalid` config (unchanged)
- `src/lib/types.ts`: `ResultStatus` includes `'invalid'` (unchanged)
- `.agents/session-summary.md`: This file — overall project/design/session context
