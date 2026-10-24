# Run Page: Remove Case-Assignment Notifications

## Problem
When a test case is assigned to someone in a run, `assignRunResultAction` calls `NotificationService.notifyCaseAssigned`, which fires an in-app + Slack channel + Slack DM + email notification **per assignment**. The service ignores the project's `custom_events_matrix`, so notifications fire even when `case_assigned` is toggled off in project settings. With many cases assigned, this is irritating.

## Decision (user-directed)
Remove the case-assignment notification feature entirely:
- No notification logic for assigning a test case in a run.
- Remove the `case_assigned` setting row from the project notification settings matrix.
- Remove the `slack_dm_webhook` user-preference setting (used only by case-assigned Slack DM).

Out of scope: other notification types (run completed, defect raised, etc.) — untouched.

## Files to edit & tasks

### 1. `src/lib/notifications/service.ts`
- Delete the entire `notifyCaseAssigned` function (lines 59–267).
- Remove the now-unused import `shouldSendEmail` from `@/lib/email/preferences` (only used by `notifyCaseAssigned`).
- Keep `sendSlackWebhook`, `SlackPayload`, `runCompleteTemplate`, `reviewRequestTemplate` (still used by other notifiers).
- Leave `mentionTemplate` import as-is (already unused before this change; out of scope).

### 2. `src/app/actions/runs.ts`
- In `assignRunResultAction` (lines ~1156–1171), delete:
  - the comment `// Dispatch multi-channel notifications (In-App, Slack Channel, Slack DM, Email)`
  - the `NotificationService.notifyCaseAssigned({...}).catch(...)` block
- Keep the `prisma.runResult.update` (the assignment itself) and `return true`.

### 3. `src/app/(main)/p/[slug]/settings/notifications/page.tsx`
- Remove `'case_assigned'` from the `EventKey` union type.
- Remove `case_assigned: { slack: true, in_app: true, email: true }` from `RECOMMENDED_MATRIX`.
- Remove the `{ key: 'case_assigned', ... }` entry from `EVENT_ROWS`.
- Remove `case_assigned: 'Cases'` from `EVENT_GROUP_ORDER`.
- Result: the matrix table no longer renders a "Case assigned" row.

### 4. `src/lib/email/preferences.ts`
- Remove `'case_assigned'` from the `eventType` union type.
- Remove `if (eventType === 'invite' || eventType === 'case_assigned') return true;` → keep only `if (eventType === 'invite') return true;`.
- `shouldSendEmail` is no longer called by `notifyCaseAssigned`; verify no other caller passes `'case_assigned'` (grep confirmed none).

### 5. `src/app/actions/notifications.ts`
- Remove `slack_dm_webhook?: string | null` from `updateNotificationPrefsAction`'s `data` param.
- Remove the `testSlackDmWebhookAction` function (only meaningful for the removed Slack DM setting).
- Keep `getNotificationPrefsAction`, `getUserNotificationPrefsAction`, project/workspace notification actions untouched.

### 6. `prisma/schema.prisma`
- Remove `slack_dm_webhook String?` from the `UserNotificationPrefs` model.

### 7. `prisma/migrations/0_init/migration.sql`
- Remove the `"slack_dm_webhook" TEXT,` line from the `UserNotificationPrefs` CREATE TABLE (affects fresh DBs only).
- For existing databases, a new migration is required to drop the column:
  - Run `prisma migrate dev --name remove_slack_dm_webhook` after editing the schema, which generates and applies an `ALTER TABLE ... DROP COLUMN "slack_dm_webhook"` migration.

## Validation
- `npx tsc --noEmit` → 0 errors (no remaining references to `notifyCaseAssigned`, `case_assigned` eventType, or `slack_dm_webhook`).
- `npx vitest run` → existing tests still pass (no tests reference the removed features per repo-wide grep).
- `npx eslint` on changed files → no new errors.
- `assignRunResultAction` no longer dispatches any notification (assignment still works).
- Project notifications settings page renders without a "Case assigned" row.

## Risks / open decisions
- `slack_dm_webhook` column: removing from schema + migration.sql handles fresh DBs; existing DBs need a new drop-column migration (documented above). Alternatively leave the nullable column in place (harmless) and only remove from schema/model — note this tradeoff in the plan.
- `custom_events_matrix` may already contain a stored `case_assigned` key for some projects. Since `notifyCaseAssigned` is removed and never reads the matrix, stale keys are harmless. The UI will no longer display or save `case_assigned`.
- In-app notification (`prisma.notification.create` with type `CASE_ASSIGNED`) is removed entirely — no other code inserts `CASE_ASSIGNED` notifications (grep confirmed).

## Out of scope
- Slack channel webhook project setting (`slack_webhook_url`) — kept (used by defect/run notifications).
- All other notification types — untouched.
