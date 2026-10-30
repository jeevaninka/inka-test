# Report Page Improvements (4 feedback items)

## Goal
Fix four issues on the shared run report page (`/r/[runId]/report` and internal `/p/[slug]/runs/[runId]/report`):

1. **Status column shows "by Jee Pass"** — executor attribution "by {name}" sits immediately left of the status badge making it read as one phrase ("by Jee Pass").
2. **Team progress progress rings need n/n beside ring** — ring doesn't fit big numbers; show "X of Y" text beside each tester's ring.
3. **Report URLs still not public accessible** — shared view requires login; need revocable token share links (7d / 30d / never), read-only, hides details unless "Include details" is on.
4. **No report generation banner for incomplete runs** — no "In progress · snapshot at {time} · N pending" banner on the report.

## Related files
- `src/app/r/[runId]/report/page.tsx` — server component that fetches run data + builds `ReportData`
- `src/app/r/[runId]/report/ReportShell.tsx` — client report shell (stats, ring, table, bugs, team progress)
- `src/app/(main)/p/[slug]/runs/[runId]/report/page.tsx` — internal report page (parallel client implementation)
- `src/components/common/ResultStatusBadge.tsx` — status badge component
- `src/components/common/ProgressCircle.tsx` — reusable progress ring component (already exists)
- `src/lib/runs/team-progress.ts` — builds `TeamRow[]` (has `total`/`passed`/`failed`/`blocked`/`pending`/`executed`)

---

## Item 1 — Status column "by Jee Pass" (RunDeck case table)

**Root cause:** `RunDeck.tsx:2470-2478` renders executor attribution as `<span>by {getExecutorName(result.executedBy)}</span>` immediately adjacent to the status badge (popover trigger). On narrow rows they visually merge into "by Jee Pass".

**Decision:** Keep executor attribution but add explicit spacing/separator so it reads as "by Jeevan · Pass" not "by Jee Pass". Make "by" label visually secondary (muted, smaller) and add a separator dot between name and status badge when both present. Only show "by" when `executedBy != assignedTo` (already guarded).

**Files to edit:** `src/app/(main)/p/[slug]/runs/[runId]/RunDeck.tsx`

**Changes:**
- In the result/status cell block around line 2468-2478: change the "by" span to include a centered dot separator and slightly looser gap so name and badge don't merge visually.
  - `className="flex min-w-0 items-center gap-1"` → keep gap but ensure name truncates, badge stays whole.
  - `title="Executed by"` retained.

**Validation:**
- `npx tsc --noEmit` clean for RunDeck.tsx
- Status badge and "by Jeevan" visually separated (not a merged phrase)

---

## Item 2 — Team progress rings show n/n beside ring

**Root cause:** `ReportShell.TeamProgressSection` (line 623-669) uses a thin horizontal progress bar and only numeric columns. User wants progress rings with "X of Y" beside each ring since rings don't fit big numbers.

**Decision:** Keep the table row structure but replace the plain bar cell (`line 656-660`) with `ProgressCircle` ring sized ~32-40px plus a centered "passed/total" subtitle beneath each ring. Add ring color based on pass rate (emerald/rose/amber). Table already has `Total` column; reuse `r.passed`/`r.total` for the n/n text.

**Files to edit:** `src/app/r/[runId]/report/ReportShell.tsx`

**Changes:**
- Import `ProgressCircle` from `@/components/common/ProgressCircle`.
- In `TeamProgressSection` row cell (time column area ~line 655-660): replace bar with:
  ```tsx
  <div className="flex items-center gap-1.5">
    <ProgressCircle
      segments={{ pass: r.passed, fail: r.failed, blocked: r.blocked, invalid: r.invalid, error: r.error, skip: r.skip, total: r.total }}
      size={28} strokeWidth={3} animate showDot
      centerContent={<span className="text-[9px] font-bold font-mono">{r.passed}</span>}
    />
    <span className="text-[10px] font-mono text-muted-foreground">{r.passed}/{r.total}</span>
  </div>
  ```
- Remove the standalone `Total` column (or keep it small); keep Passed/Failed/Blocked/Time columns.
- Keep the footer summary line (`{totalExecuted} cases executed across {rows.length} testers`).

**Validation:**
- `npx tsc --noEmit` clean
- Ring renders per tester with correct percentage color
- "X of Y" text beside each ring

---

## Item 3 — Report URLs public accessible (share token links)

**Root cause:** Report page requires login + workspace membership (`page.tsx:60-73`). The "Shared link" footer (ReportShell line 364-369) and "Copy link" button (line 308) just copy `window.location.href` which is behind auth. No revocable token, expiry, or read-only shared view exists.

**Decision:** Implement share-token layer:
- New DB model `RunReportShare` (or reuse pattern): token (≥128-bit random, e.g. crypto.randomUUID or 32-byte hex), runId, createdBy, expiresAt (7d / 30d / never), revokedAt, readOnly flag.
- Server actions: `createRunReportShare(runId, expiry)`, `revokeRunReportShare(token)`, `getRunReportShare(token)` (returns run + readOnly).
- Public route: `/r/[runId]/report/share/[token]` — no auth, loads report via token, validates expiry/revocation.
- Shared view behavior: hides raw request/response bodies, variables, secrets unless `?details=1` / "Include details" is on; masks sensitive fields (tokens, PAN, Aadhaar, passwords, OTP, API keys) in all exports.
- Show link status (active / expires / revoke) on the run page; log opens if available.
- Default: internal view + PDF = include team progress ON; shared links = OFF.

**Files to edit:**
- `prisma/schema.prisma` — add `RunReportShare` model
- `src/app/actions/runs.ts` (or new `src/app/actions/report-shares.ts`) — create/revoke/get share actions
- `src/app/r/[runId]/report/share/[token]/page.tsx` — new public share route (server component, no auth)
- `src/app/r/[runId]/report/ReportShell.tsx` — add "Share link" UI (expiry selector, copy token URL, revoke button, status badge)
- `src/app/r/[runId]/report/page.tsx` — pass `expiresAt`/`shareToken` into `mappedRun`

**Validation:**
- `npx tsc --noEmit` clean
- Share token generated is ≥128-bit random
- Expiry options: 7d / 30d / never
- Revoke button works; status shows active/expires/revoked
- Shared route returns 401/404 for invalid/expired/revoked tokens

---

## Item 4 — Report generation banner for incomplete runs

**Root cause:** `ReportShell` computes `effectiveResult` (returns 'In progress' when run unfinished) but there's no prominent "In progress · snapshot at {time} · N pending" banner. `page.tsx:640` in internal report has `isRunInProgress` but shows hardcoded `{0} pending`.

**Decision:** Add a yellow/info banner just under the report header meta, shown only when the run is incomplete (has pending/queued/running cases). Banner text: "In progress · snapshot at {fmtDateTime(new Date())} · {pendingCount} pending". Also add "Draft" watermark on PDF when incomplete. Headline uses "Executed X of Y" instead of pass-rate when incomplete.

**Files to edit:** `src/app/r/[runId]/report/ReportShell.tsx`

**Changes:**
- Compute `pendingCount` = results with status pending/queued/running.
- Compute `isRunInProgress` = run not completed/aborted AND pendingCount > 0.
- Add banner above Title block (line 270):
  ```tsx
  {isRunInProgress && (
    <div className="print-hidden mb-2 p-2.5 rounded bg-amber-50 border border-amber-200/60 text-[11px] font-medium text-amber-700 flex items-center gap-2">
      <Clock className="h-3.5 w-3.5 animate-pulse" />
      <span>In progress · snapshot at {fmtDateTime(new Date())} · {pendingCount} pending</span>
    </div>
  )}
  ```
- In `PassRateRing` subtitle: when `isRunInProgress`, show "Executed {passed} of {total}" instead of pass rate.
- Add `draft-watermark` print CSS: `position:fixed; opacity:0.1; rotate: -45deg; text-9xl; font-bold; color: red` when `isRunInProgress`.

**Validation:**
- `npx tsc --noEmit` clean
- Banner visible only for incomplete runs
- "Draft" watermark appears in print/PDF for incomplete runs

---

## Acceptance / Validation (all items)
- `npx tsc --noEmit` → 0 errors across edited files
- `npx eslint` on edited files → no NEW errors
- `npx vitest run` green
- Report opens for incomplete run → banner shows "In progress · snapshot at ... · N pending"
- Team progress table → each tester has ProgressCircle ring + "X of Y" text
- Share flow → token link created, copied, revoked; shared URL opens without login; details hidden by default
- Status column in RunDeck → "by {name}" visually separated from status badge

## Risks
- `RunDeck.tsx` is ~4100 lines — make small targeted edits only
- Share-token DB migration needed (`prisma migrate dev`)
- Public share route must not leak auth session or internal fields
- Team progress ring size must stay small enough to fit table row

## Out of scope
- Bugs table column rework (already exists in ReportShell `BugsSection`)
- Automated run execution logic changes (item 5 from original scope — no logic changes to run execution)

## Files to edit (summary)
1. `src/app/r/[runId]/report/ReportShell.tsx` — Items 2, 4 (+ Item 3 share UI)
2. `src/app/r/[runId]/report/page.tsx` — Item 3 (pass expiresAt/shareToken)
3. `src/app/(main)/p/[slug]/runs/[runId]/RunDeck.tsx` — Item 1
4. `prisma/schema.prisma` — Item 3 (RunReportShare model)
5. `src/app/actions/report-shares.ts` (new) — Item 3 (create/revoke/get share actions)
6. `src/app/r/[runId]/report/share/[token]/page.tsx` (new) — Item 3 (public share route)
