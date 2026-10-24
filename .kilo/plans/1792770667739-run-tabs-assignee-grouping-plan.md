# Run Page Tabs — Cases | Bugs (History out of scope)

## Scope decision (user-directed)
- Build **Cases | Bugs** navigation tabs only. **History is intentionally skipped** — see "Why skip History" below.
- Tab row stays `Cases | Bugs` (no History tab).

## Why skip History
- Each case already has a "History & Audit" tab in the case console covering "who changed this result".
- Run-level metadata already visible: header shows who started it and when; Team table shows who executed what and when.
- An empty-looking History tab (only "created/started/finished") adds clutter.
- **Cheaper alternative (future):** put "Activity" in the run's ⋮ menu as a drawer; feed available on demand without a permanent tab.
- **If added later:** reverse-chronological feed with actor/time/one-line description — run created/started/stopped/resumed/finished/re-run, cases added/removed, assignee changes, result changes, bugs raised/linked, settings changes.

## Current State (verified in file)
- `RunDeck.tsx` already contains:
  - `resolveAssignee` callback mapping `leaf.assignedTo` against project `members`
  - `teamRows` via `buildTeamProgress(results, resolveAssignee)`
  - `hasManualCases`
  - `GroupingTabs` with modes `['flat', 'module', 'assignee']`
  - `resultsByGroup` assignee branch grouping results under assignee headers + `Unassigned`
  - `TeamProgressModal` rendered with `onSelectAssignee`/`onGroupByAssignee`/`onRefresh={refetchResults}`
- `run-view-filters.ts` already exports `RunGroupBy` incl. `'assignee'`, `RUN_GROUP_OPTIONS`, `defaultRunViewFilters`, `loadRunViewFilters`, `saveRunViewFilters`, `patchRunViewFilters`.
- `getRunDefectsAction(runId)` exists in `src/app/actions/defects.ts` returning `ProjectDefectItem[]` (newest-first), incl. `testCaseDisplayId`, `title`, `severity`, `localStatus`, `raisedByName`, `raisedAt`, `ticketUrl`, `externalTicketId`.
- `DefectDetailModal` accepts `DefectItemData` (`id`, `title`, `description`, `severity`, `localStatus`, `ticketUrl`, `externalTicketId`, `raisedBy`, `raisedByName`, `raisedAt`).

## Remaining Work (Request 9 — Cases | Bugs tabs only)

### Imports to add to RunDeck.tsx
- `useSearchParams` from `next/navigation` (alongside existing `useRouter`)
- `Bug`, `FileText` from `lucide-react` (drop `History`)
- `getRunDefectsAction`, type `ProjectDefectItem` from `@/app/actions/defects`
- `DefectDetailModal` from `@/components/runs/DefectDetailModal`

### State to add (in RunDeck component)
- `deckTab: 'cases' | 'bugs'` — init from `searchParams?.get('tab')`; only `'bugs'` accepted, else `'cases'`
- `runDefects: ProjectDefectItem[]` — fetched via `getRunDefectsAction(runId)` on mount (effect on `[runId]`)
- `loadingDefects: boolean`
- `selectedDefect: ProjectDefectItem | null`

### Tab bar (above search/toolbar row)
- Two buttons: Cases (`FileText` + count `{results.length}`), Bugs (`Bug` + rose badge `{runDefects.length}` when >0)
- Active = `border-primary text-primary` with bottom border; inactive = muted text, hover
- Each `onClick` sets `deckTab` AND URL-synces `?tab=<tab>` via `router.replace(url.pathname + url.search, { scroll: false })` preserving existing params

### URL sync
- `deckTab` initialized from `searchParams?.get('tab')` (only `'bugs'` accepted; else `'cases'`)
- Changing tab updates `?tab=` without losing other search params

### Tab content
- `deckTab === 'cases'` → existing cases table + grouping controls (unchanged); toolbar (search + GroupingTabs + Filter popover + chips) wrapped in `{deckTab === 'cases' && (...)}` — visible only on Cases tab
- `deckTab === 'bugs'` → defects table:
  - Loading: "Loading bugs…" text
  - Empty: "No bugs logged for this test run" state + subtext "Defects raised against this run appear here."
  - Columns: Bug ID | Title & Case | Severity | Status | Reported By | External Ticket
  - Rows render defect data; click row opens `DefectDetailModal` with `selectedDefect`
  - Severity badge color per DefectDetailModal config (blocker/critical/urgent → rose; high/major → orange; medium/minor → amber; low → blue)
  - Status pill inline (open → emerald; resolved/closed/wont fix → zinc)
  - External ticket column: link if `ticketUrl`/`externalTicketId` present, else "—"

### Bugs tab table structure
- Mirror existing table classes: `<table className="w-full ...">` with `<thead>` (`[&_th]:text-[10px]...`) and `<tbody>` rows (`border-b border-border/40 hover:bg-muted/50 cursor-pointer`)

### DefectDetailModal wiring
- `open={!!selectedDefect}`, `onOpenChange` clears selection, passes mapped `DefectItemData`

## Acceptance / Validation
- `npx tsc --noEmit` clean (0 errors) for `RunDeck.tsx`
- `npx eslint` on `RunDeck.tsx` → no NEW errors (pre-existing `no-explicit-any`/legacy warnings acceptable)
- `npx vitest run` green (existing tests still pass)
- Tabs render Cases | Bugs; URL `?tab=bugs` persists on navigation
- Bugs badge count updates after `getRunDefectsAction` fetch
- Empty state shows when `runDefects.length === 0`
- Toolbar hidden on Bugs tab; Cases table still renders on Cases tab

## Risks
- Large `RunDeck.tsx` (~3800 lines) — make small, targeted edits only; avoid block-wrapping corruption
- `getRunDefectsAction` is a server action; call inside client `useEffect` (patterned elsewhere in file)
- `searchParams` is `URLSearchParams | null` — guard with `?.get('tab')`
- Do NOT add History tab; keep tab row to `Cases | Bugs` only

## Files to edit
- `src/app/(main)/p/[slug]/runs/[runId]/RunDeck.tsx` (only file needing changes)

## Out of scope
- History tab (see rationale above)
- "Activity" drawer in ⋮ menu (future alternative, not now)
