# InkaTest (InkaQA) — Enterprise Architecture & Deployment Plan

An AI-first, multi-tenant QA Intelligence & Test Case Management platform built with Next.js 16, PostgreSQL, Prisma, Google Gemini, and AWS cloud services (Amplify, S3, SES).

---

## 1. System Overview & Multi-Tenant Hierarchy

InkaTest is structured around a strict 3-tier multi-tenant hierarchy with role-based access control (RBAC) enforced at every layer:

1. **Platform Level (`/platform-admin`)**
   - Governed by `User.is_platform_admin` and `User.is_approved`.
   - Manages top-level `Organization` provisioning and platform-wide governance.
2. **Organization Level (`/org/[slug]`)**
   - Models: `Organization`, `OrganizationMember`, `OrganizationJoinRequest`, `OrganizationInvitation`, `OrganizationInvitationWorkspaceGrant`.
   - Supports allowed email domain auto-join (`allowed_domains`, `domain_join_enabled`), organization-level invitations with multi-workspace role grants, and join request approvals.
3. **Workspace Level (`/workspace/[slug]`)**
   - Models: `Workspace`, `WorkspaceMember`, `WorkspaceJoinRequest`, `Invitation`, `ApiKey`, `AuditLog`.
   - Roles (`WorkspaceRole`):
     - `OWNER` / `ADMIN`: Full workspace administration, member invitations, workspace integrations, webhooks, and project creation.
     - `MEMBER`: Standard access to assigned projects (`TESTER` default).
     - `GUEST`: Strictly read-only (`VIEWER`) across all projects in the workspace.
4. **Project Level (`/p/[slug]`)**
   - Models: `Project`, `ProjectMember`.
   - Roles (`ProjectRole`):
     - `ADMIN`: Full project settings, issue tracker mappings, API secrets, releases, and test assets.
     - `TESTER`: Create/edit test cases, suites, runs, execute tests, raise defects, and request reviews.
     - `VIEWER`: Read-only access to dashboards, repository, suites, runs, and reports.

---

## 2. Production Technology Stack

| Layer | Technology | Details |
|---|---|---|
| **Framework** | Next.js `16.2.9` (App Router) | React `19.2.4`, Server Components, Server Actions (`bodySizeLimit: 10mb`), Route Handlers |
| **Language** | TypeScript `5` | Strict mode enabled |
| **Database & ORM** | PostgreSQL 14+ & Prisma `5.22.0` | Connection-pooled Prisma client (`src/lib/db.ts`), versioned SQL migrations (`prisma/migrations`) |
| **Authentication** | NextAuth.js `4.24.14` | JWT session strategy (7-day max age, 1-hr rolling refresh), Google OAuth 2.0 (production), Credentials provider enabled only in non-production (`src/lib/auth.config.ts`), edge/node proxy guard (`src/proxy.ts`) |
| **AI Engine** | Google Gemini (`@google/generative-ai`) | Model: `gemini-2.5-flash` (`src/lib/ai/client.ts`) with structured JSON outputs, project-level toggle (`ai_enabled`), and usage tracking (`AiCall`, `AiSuggestion`) |
| **File Storage** | AWS S3 (`@aws-sdk/client-s3`) | Presigned PUT/GET URLs (`@aws-sdk/s3-request-presigner`), magic-byte file verification, local MinIO/LocalStack support |
| **Email Service** | AWS SESv2 (`@aws-sdk/client-sesv2`) | Production delivery via IAM role or credentials; local dev fallback via `nodemailer` SMTP (`src/lib/email/send.ts`) |
| **UI & Styling** | Tailwind CSS `3.4`, Radix UI, Framer Motion | Multi-theme support (`cyber-teal`, `white`, `graphite`), Tiptap rich text editor, `@dnd-kit` drag-and-drop, Recharts analytics |
| **Security** | AES-256-GCM, SSRF Guard, DOMPurify | Secret encryption (`src/lib/crypto.ts`), DNS/IP SSRF protection (`src/lib/network/ssrf-guard.ts`), HTML sanitization (`isomorphic-dompurify`) |
| **Observability** | CloudWatch Structured Logger | JSON structured logs (`src/lib/logger.ts`), automatic secret redaction, normalized `ErrorCodes` (`src/lib/errors.ts`), request tracing (`x-request-id`) |
| **Testing** | Vitest `5.0` | Unit & security test suites (`tests/`) |
| **Hosting** | AWS Amplify Hosting (`WEB_COMPUTE`) | Next.js SSR compute runtime configured via `amplify.yml` |

---

## 3. Core Feature Matrix

### 3.1 Test Repository (`/p/[slug]/repository`)
- **Module Tree**: 2-level folder hierarchy (`Module` with `parent_id` and `order_index`) plus "All Cases" and "Without Module" views.
- **Test Cases (`TestCase`, `TestCaseStep`)**:
  - Relational step management (`TestCaseStep`) supporting step description, expected result, test data, inline step images (`/api/steps/[stepId]/image`), and linked Shared Steps (`ReusableStep`).
  - Immutable version snapshots (`TestCaseVersion`) created on modifications to preserve historical run integrity.
  - Priority (`P0`–`P3`), Type (`MANUAL` / `AUTO`), Status (`ACTIVE` / `DRAFT` / `DEPRECATED`), Scenario Type, Tags, Labels, and Custom Fields.
- **Spreadsheet Import**: Excel/CSV import (`xlsx`) with optional AI enrichment (`enrichTestCasesWithAI`).

### 3.2 Configuration Center (`/p/[slug]/configuration/*`)
- **Step Library (`/step-library`)**: Reusable step sequences (`ReusableStep`) shared across test cases; updates flag linked steps as `is_outdated`.
- **Custom Fields (`/fields`)**: Project-specific custom properties (`TEXT`, `DROPDOWN`, `MULTI_SELECT`, `BOOLEAN`, `NUMBER`, `URL`) across `TEST_CASE`, `TEST_RUN`, `RELEASE`, and `DEFECT`.
- **Variables (`/variables`)**: Global and case-scoped variables (`Variable`, `VariableValue`) with environment-specific values, secret masking (`is_secret`), and `{{variable}}` / `@variable` interpolation.
- **Parameters / Datasets (`/datasets`)**: Data-driven test datasets (`Dataset`) for parameterized multi-iteration test execution.
- **Environments (`/environments`)**: Named execution environments (`Environment`) with base URLs and default flags.
- **Execution Targets (`/targets`)**: Browsers, devices, OS, and runtime target definitions.

### 3.3 Test Suites & Execution Engine (`/p/[slug]/suites`, `/p/[slug]/runs`)
- **Test Suites (`TestSuite`, `SuiteCase`)**: Smoke, Regression, Sprint, and Custom suites with ordered test cases and default assignees.
- **Unified Execution Board (`/p/[slug]/runs/[runId]`)**:
  - **Mode A — Run Deck**: Full-width triage table grouped by Module, Suite, or Flat view; status filter pills (`Pass`, `Fail`, `Blocked`, `Skip`, `Invalid`, `Running`, `Pending`, `Retry`); bulk assignment; quick status actions; add cases; clone/abort/finish run.
  - **Mode B — Execution Console**: Modal/full-pane step-by-step executor (`/p/[slug]/runs/[runId]/[caseKey]` or `?resultId=`), per-step verdict controls, dataset iteration matrix, debounced failure notes, S3 evidence uploads, inline defect creation, and keyboard shortcuts (`1`–`5` verdicts, `←`/`→` case navigation, `Esc` return).
- **Run Report (`/p/[slug]/runs/[runId]/report`)**: Printable/shareable execution summary, pass rate metrics, failure breakdown, and linked defects.
- **CI / Automation Inbound API**: `PATCH /api/v1/runs/[runId]/results` authenticated via project `api_secret` (`Bearer` or `x-api-key`) for automated test runners.

### 3.4 Releases & Readiness Gates (`/p/[slug]/releases`)
- **Release Tracking (`Release`, `ReleaseTicket`)**: Link test runs and external PM tickets to a release milestone.
- **Sign-off Workflow**: Release approval/rejection decisions (`ReleaseDecision`) with audit metadata (`decision_by_id`, `decision_at`, `decision_note`).

### 3.5 Defects & Issue Tracker Integration (`/p/[slug]/defects`, `/p/[slug]/settings/tracker`)
- **Two-Way PM Integration (`src/lib/integrations/pm-client.ts`)**:
  - Workspace-level default PM connection with optional project-level credential overrides (AES-256-GCM encrypted).
  - Supports **InkaBoard** and **Jira** spaces, remote ticket creation on test failure, status synchronization, and inbound PM status webhooks (`POST /api/v1/projects/[projectId]/webhooks/pm-tool`).

### 3.6 Collaboration, Peer Reviews & Notifications
- **Peer Review Queue (`/p/[slug]/reviews`)**: Formal `ReviewRequest` workflow (`PENDING`, `APPROVED`, `CHANGES_REQUESTED`, `CANCELLED`) with side-by-side step diffing (`ReviewDiff.tsx`).
- **Comments & Mentions**: Threaded comments (`Comment`) with `@mention` parsing, comment assignment/resolution, and file attachments.
- **Multi-Channel Notifications (`src/lib/notifications/service.ts`)**:
  - In-app notification center (`NotificationBell`), AWS SES / SMTP transactional emails (invitations, mentions, review requests, run completion), Slack incoming webhooks, and outbound HMAC-SHA256 webhooks (`Webhook`, `WebhookDelivery`).

### 3.7 AI Capabilities (`src/lib/ai/client.ts` & `src/app/actions/ai.ts`)
1. **Generate Test Cases (`generateCases`)**: Generates structured test cases from feature descriptions, PRDs, or uploaded UI screenshots, automatically mapping to existing project modules, tags, and shared steps.
2. **Improve Test Case Steps (`improveSteps`)**: Refines existing steps, merges redundant actions, links matching shared steps, and provides a diff summary (`replacesOrders`, `changeSummary`).
3. **Spreadsheet Import Enrichment (`enrichTestCasesWithAI`)**: Expands terse spreadsheet rows into complete manual test cases in parallel batches.
4. **Auto-Generate Defect Reports (`generateDefectReport`)**: Produces reproduction-ready bug reports (title, preconditions, atomic steps to reproduce, expected vs. actual, severity, labels) from failed step context.

---

## 4. Database Schema Summary (`prisma/schema.prisma`)

### Enums
- `WorkspaceRole`: `OWNER` | `ADMIN` | `MEMBER` | `GUEST`
- `ProjectRole`: `ADMIN` | `TESTER` | `VIEWER`
- `Priority`: `P0` | `P1` | `P2` | `P3`
- `CaseType`: `MANUAL` | `AUTO`
- `CaseStatus`: `ACTIVE` | `DRAFT` | `DEPRECATED`
- `SuiteType`: `SMOKE` | `REGRESSION` | `SPRINT` | `CUSTOM`
- `RunStatus`: `IN_PROGRESS` | `COMPLETED` | `FAILED` | `ABORTED`
- `ResultStatus`: `PENDING` | `PASS` | `FAIL` | `BLOCKED` | `SKIP` | `INVALID`
- `ReviewStatus`: `PENDING` | `APPROVED` | `CHANGES_REQUESTED` | `CANCELLED`
- `VariableScope`: `GLOBAL` | `LOCAL`
- `SuggestionType`: `SELF_HEAL` | `NEW_TEST_CASE` | `DEDUP_DEFECT`
- `SuggestionStatus`: `PENDING` | `APPROVED` | `REJECTED`
- `InvitationStatus`: `PENDING` | `ACCEPTED` | `REJECTED`
- `JoinRequestStatus`: `PENDING` | `APPROVED` | `REJECTED`
- `Severity`: `CRITICAL` | `HIGH` | `MEDIUM` | `LOW`
- `ReleaseDecision`: `APPROVED` | `REJECTED`
- `CustomFieldType`: `TEXT` | `DROPDOWN` | `MULTI_SELECT` | `BOOLEAN` | `NUMBER` | `URL`
- `CustomFieldEntityType`: `TEST_CASE` | `TEST_RUN` | `RELEASE` | `DEFECT`

### Models (31 Total)
- **Identity & Tenancy**: `User`, `Organization`, `OrganizationMember`, `OrganizationJoinRequest`, `OrganizationInvitation`, `OrganizationInvitationWorkspaceGrant`, `Workspace`, `WorkspaceMember`, `WorkspaceJoinRequest`, `Invitation`, `ApiKey`, `Project`, `ProjectMember`
- **Repository & Configuration**: `Module`, `Dataset`, `TestCase`, `ReusableStep`, `TestCaseStep`, `TestCaseVersion`, `Environment`, `Variable`, `VariableValue`, `CustomFieldDefinition`, `SavedView`
- **Execution & Releases**: `TestSuite`, `SuiteCase`, `TestRun`, `RunResult`, `RunResultStep`, `Release`, `ReleaseTicket`
- **AI**: `ExploratorySession`, `AiSuggestion`, `AiCall`
- **Collaboration & Notifications**: `Comment`, `ReviewRequest`, `Notification`, `UserNotificationPrefs`, `NotificationSettings`
- **Defects, Storage, Audit & Webhooks**: `Defect`, `Attachment`, `ActivityLog`, `AuditLog`, `Integration`, `Webhook`, `WebhookDelivery`

---

## 5. Application Routes & API Endpoints

### UI Routes (`src/app/`)
| Route | Purpose |
|---|---|
| `/` | Redirects to `/workspace` (via `/projects`) |
| `/login` | Authentication (Google OAuth + non-prod Credentials) |
| `/invite` | Accept workspace or organization invitation token |
| `/pending` | Holding screen for unapproved accounts |
| `/setup` | First-time onboarding setup for approved users without a workspace |
| `/profile` | User profile, avatar, and notification preferences |
| `/platform-admin`, `/platform-admin/organizations` | Platform-wide organization & admin management |
| `/org/[slug]/invitations`, `/members`, `/domains`, `/approvals` | Organization administration portal |
| `/workspace` | Workspace selector & join request portal |
| `/workspace/[slug]` | Workspace project directory |
| `/workspace/[slug]/settings/general`, `/members`, `/invitations`, `/approvals`, `/integrations` | Workspace administration & default integrations |
| `/p/[slug]` | Project Quality Dashboard (KPIs, trends, activity) |
| `/p/[slug]/repository`, `/p/[slug]/repository/[caseId]` | Test Case Repository & master-detail editor |
| `/p/[slug]/suites`, `/p/[slug]/suites/[suiteId]` | Test Suites list & suite builder |
| `/p/[slug]/runs`, `/p/[slug]/runs/new` | Test Runs list & multi-step run creation wizard |
| `/p/[slug]/runs/[runId]`, `/p/[slug]/runs/[runId]/[caseKey]` | Unified Run Deck & Execution Console |
| `/p/[slug]/runs/[runId]/report` | Test Run Summary & Printable Report |
| `/p/[slug]/releases` | Release management & ticket readiness |
| `/p/[slug]/defects` | Project Defects tracker & status sync |
| `/p/[slug]/reviews`, `/p/[slug]/reviews/[caseId]` | Peer Review Queue & version diff view |
| `/p/[slug]/configuration/step-library`, `/fields`, `/variables`, `/datasets`, `/environments`, `/targets` | Project Configuration Center |
| `/p/[slug]/settings/general`, `/members`, `/tracker`, `/notifications`, `/developer`, `/releases`, `/ai` | Project Settings |

### API Routes (`src/app/api/`)
| Endpoint | Method(s) | Auth | Purpose |
|---|---|---|---|
| `/api/health` | `GET` | Public | Health check & database connectivity probe (`SELECT 1`) |
| `/api/auth/[...nextauth]` | `GET, POST` | Public | NextAuth OAuth & session endpoints |
| `/api/v1/logs` | `POST` | Public | Client-side error/warn log ingestion for CloudWatch |
| `/api/v1/workspaces/active` | `GET` | Session | Resolve active workspace for current user |
| `/api/v1/workspaces/[workspaceSlug]` | `GET` | Session | Workspace metadata & role lookup |
| `/api/v1/workspaces/[workspaceSlug]/webhooks/incoming` | `POST` | Secret | Workspace-level inbound CI/automation webhook |
| `/api/v1/projects` | `GET, POST` | Session | List or create workspace projects |
| `/api/v1/projects/[projectId]/badges` | `GET` | Session | Sidebar badge counts (pending reviews, open defects, releases) |
| `/api/v1/projects/[projectId]/defects` | `GET` | Session | Project defects list |
| `/api/v1/projects/[projectId]/reviews` | `GET` | Session | Project review queue list |
| `/api/v1/projects/[projectId]/webhooks/incoming` | `POST` | Secret | Project-level inbound CI webhook |
| `/api/v1/projects/[projectId]/webhooks/pm-tool` | `POST` | Secret | Inbound PM tool (InkaBoard/Jira) ticket status webhook |
| `/api/v1/cases/[caseId]` | `GET` | Session | Full test case details & steps |
| `/api/v1/runs/[runId]/results` | `GET, PATCH` | Session / API Secret | Fetch run results (`GET`) or submit automated test results (`PATCH`) |
| `/api/v1/runs/[runId]/results/[resultId]/details` | `GET` | Session | Detailed step results, attachments, and defects for a run result |
| `/api/v1/notifications` | `GET` | Session | User notifications list & unread count |
| `/api/v1/attachments/upload` | `POST` | Session | Generate S3 presigned upload URL |
| `/api/v1/attachments/complete` | `PATCH` | Session | Verify magic bytes on S3 object and mark attachment `ACTIVE` |
| `/api/v1/attachments/link` | `POST` | Session | Attach external link with SSRF-guarded OpenGraph preview |
| `/api/v1/attachments/[id]` | `GET, DELETE` | Session | Get or soft-delete attachment |
| `/api/v1/attachments/[id]/download` | `GET` | Session | Generate S3 presigned download URL |
| `/api/steps/[stepId]/image` | `GET` | Session | Serve inline step image from S3 or data URI |
| `/api/projects/[projectId]/variables/[key]/usage` | `GET` | Session | Check test case usage of a variable before deletion |

---

## 6. Deployment & Database Migration Runbook (AWS Amplify)

### 6.1 Prerequisites on AWS
1. **Amazon RDS (PostgreSQL 14+)**:
   - Create database `inkatest`. Ensure the Amplify compute VPC or security group permits outbound traffic on port `5432`.
2. **Amazon S3**:
   - Create private bucket (e.g., `inkatest-attachments-prod`) in `ap-south-1`.
   - Configure CORS on the bucket to allow `PUT` and `GET` from your Amplify domain (`NEXTAUTH_URL`).
3. **Amazon SES**:
   - Verify sender domain/address (`SES_FROM_EMAIL` / `MAIL_FROM`) in `ap-south-1` and request production access (exit SES sandbox).
4. **IAM Execution Role for Amplify**:
   - Attach policies granting `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the S3 bucket ARN and `ses:SendEmail` on the SES identity ARN.
   - *(Because AWS Amplify Console blocks custom environment variable names starting with `AWS_`, the app uses the Amplify IAM role automatically and reads `S3_REGION`, `S3_BUCKET_NAME`, `SES_REGION`, and `SES_FROM_EMAIL` / `MAIL_FROM`).*

### 6.2 Required Amplify Environment Variables
Configure the following in **AWS Amplify Console → App settings → Environment variables** (see `.env.example` for full list):
- `APP_ENV=production`
- `NEXT_PUBLIC_APP_ENV=production`
- `NEXT_PUBLIC_APP_URL=https://qa.yourdomain.com`
- `DATABASE_URL=postgresql://user:pass@rds-host:5432/inkatest?schema=public&connection_limit=10&pool_timeout=20`
- `NEXTAUTH_URL=https://qa.yourdomain.com`
- `NEXTAUTH_SECRET=<openssl rand -base64 32>`
- `ENCRYPTION_KEY=<openssl rand -base64 32>`
- `GOOGLE_CLIENT_ID=<google-oauth-client-id>`
- `GOOGLE_CLIENT_SECRET=<google-oauth-client-secret>`
- `GEMINI_API_KEY=<google-gemini-api-key>`
- `S3_REGION=ap-south-1`
- `S3_BUCKET_NAME=<your-s3-bucket>`
- `EMAIL_PROVIDER=ses`
- `SES_REGION=ap-south-1`
- `SES_FROM_EMAIL=noreply@yourdomain.com`
- `MAIL_FROM=noreply@yourdomain.com`
- `LOG_LEVEL=info`

### 6.3 Database Migration Lifecycle
- **Baseline Setup (Existing DB created via `db push`)**:
  Run once against an already-populated database so Prisma records the baseline as applied:
  ```bash
  pnpm db:migrate:resolve --applied 0_init
  ```
- **Creating New Migrations (Local Dev)**:
  ```bash
  pnpm db:migrate:dev --name <descriptive_name>
  ```
  Commit the generated `prisma/migrations/<timestamp>_<name>/migration.sql` file.
- **Automated Execution on Deploy (`amplify.yml`)**:
  During each Amplify build, `npx prisma migrate deploy` runs automatically before `pnpm run build`.
- **Resolving Failed Migrations**:
  - If a migration fails during build, the Amplify build halts and production stays on the previous live deployment.
  - To mark a rolled-back migration as resolved after fixing the issue:
    ```bash
    pnpm db:migrate:resolve --rolled-back <migration_name>
    ```
  - To bypass migrations during an emergency code-only hotfix deploy, set `SKIP_DB_MIGRATE=true` in the Amplify Console.

### 6.4 Post-Deployment Verification
1. Check `GET https://qa.yourdomain.com/api/health` — verify HTTP `200` and `{"status":"ok","database":"connected"}`.
2. Sign in via Google OAuth at `/login` (verify password login form is hidden in production).
3. Verify S3 presigned upload/download on a test case or run result.
4. Verify SES email delivery by sending a workspace/project invitation.
5. Check AWS CloudWatch Logs for structured JSON log entries from `service: "inkatest"`.
