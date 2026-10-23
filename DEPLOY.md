# Deploy Readiness — InkaQA

Operational checklist for the Next.js 16 / Prisma 5.22 / Postgres stack on AWS
Amplify (WEB_COMPUTE). Everything marked **DONE** is enforced in the repo;
everything marked **ACTION** is a one-time console/infrastructure step.

---

## 1. Build & runtime (Amplify)

| Item | Status | Where |
| --- | --- | --- |
| Prisma engine for Amazon Linux | DONE | `prisma/schema.prisma` → `binaryTargets = ["native", "rhel-openssl-3.0.x"]` |
| `prisma generate` in build | DONE | `amplify.yml` preBuild |
| Migrations **not** run in build | DONE | removed from `amplify.yml`; see `deploy-migrations` workflow |
| Runtime env vars for SSR | DONE | `amplify.yml` writes selected vars to `.env.production` |
| Node 20 pinned | ACTION | Amplify console → Build settings → Node.js version = 20 |
| `DIRECT_URL` secret | ACTION | GitHub repo secret used by `.github/workflows/deploy-migrations.yml` |
| Branch → env mapping | ACTION | `main` = production; PR previews get a **separate** database |

### Environment variables that must exist on the Amplify branch

`DATABASE_URL` (pooled, `connection_limit=3`), `NEXTAUTH_URL`, `NEXTAUTH_SECRET`,
`ENCRYPTION_KEY`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`,
`EMAIL_PROVIDER`, `MAIL_FROM`, `SES_REGION`, `SES_FROM_EMAIL`, `S3_REGION`,
`S3_BUCKET_NAME`, `APP_ENV=production`, `LOG_LEVEL=info`, plus any
`NEXT_PUBLIC_*` you actually need at build time.

`NEXT_PUBLIC_*` is inlined at build time — never put a secret behind that prefix.

---

## 2. Database connectivity & pooling

- Amplify SSR compute cannot join a private VPC. The database must be reachable
  over TLS from the public internet with tight credentials/security groups, or
  fronted by RDS Proxy / a managed pooler.
- `DATABASE_URL` must point at the **pooler** and carry `connection_limit=3`
  (`src/lib/db.ts` also defaults it to 3 and `pool_timeout=20`).
- Migrations use the **direct** URL (`DIRECT_URL`) in CI, never the pooler.
- Do not add `pgbouncer=true` when using RDS Proxy (Prisma pins prepared
  statements; RDS Proxy does not need the flag). Use it only for real PgBouncer
  in transaction mode.

---

## 3. Migrations

1. `prisma migrate deploy` runs once, serially, from
   `.github/workflows/deploy-migrations.yml` (concurrency group prevents races).
2. Rehearse on a production copy: `DATABASE_URL=<copy> npx prisma migrate deploy`.
3. Rules: expand → migrate → contract. No destructive change in the same release
   as the code that stops using the old column.
4. Prisma has no down migrations. Rollback = restore snapshot, or ship a forward
   fix. Take a snapshot before the first production migration.
5. Pending work from this pass: `20261023150000_deploy_hardening_indexes`
   (FK + list-query indexes). Verify with `EXPLAIN ANALYZE` on production-sized
   data before/after; drop any index that does not get used.

---

## 4. Security posture

- **Tenant isolation** is enforced per action/route via `requireProject*` /
  `requireWorkspace*` helpers. DAL readers that take a bare id now require an
  explicit scope (`getTestCaseById`, `getTestRunById`). Any new query that takes
  an id must carry `project_id` / `workspace_id` in the `where` clause.
- **Cross-tenant regression tests**: `tests/security/actions-authorization.test.ts`
  and `tests/security/tenant-scope.test.ts`.
- **Credentials at rest**: integration configs and webhook secrets are AES-256-GCM
  encrypted (`src/lib/crypto.ts`, `enc:v1:` prefix) and never returned raw.
- **Webhooks**: inbound HMAC verification is fail-closed; outbound URLs pass the
  SSRF guard (`src/lib/network/ssrf-guard.ts`).
- **Headers**: CSP, HSTS, `X-Frame-Options: DENY`, `nosniff`, Referrer-Policy,
  Permissions-Policy (`next.config.ts`).
- **Rate limits**: login (`enforceLoginRateLimit`), AI
  (`enforceAiRateLimit`), imports (`enforceImportRateLimit`), uploads
  (`hit()` in the upload route). In-memory per instance — replace with Redis
  when running more than one instance.
- **ACTION**: rotate any secret that has ever been committed; confirm no
  `NEXT_PUBLIC_*` holds a credential.

---

## 5. Timeouts (Amplify SSR ≈ 30s)

- Provider calls are capped at `AI_REQUEST_TIMEOUT_MS` (default 25s).
- Excel import is capped at `IMPORT_MAX_ROWS` (default 500) and rate limited.
- **ACTION / known limitation**: single-request AI generation for very large
  inputs and very large Excel files still run inside one request. If you need
  more than ~25s of work, move it to a job table + polling endpoint. Do not raise
  `AI_REQUEST_TIMEOUT_MS` above the platform limit.

---

## 6. Observability & backups

- **ACTION**: enable Sentry (or CloudWatch RUM/APM) for client + server and
  upload source maps. Not wired yet — this is the largest remaining gap.
- Structured logs already include module/action/requestId (`src/lib/logger.ts`).
  Never log full AI prompts or credential values.
- `/api/health` returns DB latency and `503` when Postgres is unreachable — point
  uptime monitoring at it.
- **ACTION**: enable automated backups + point-in-time recovery, and actually
  restore one snapshot into staging.
- `error.tsx`, `global-error.tsx`, `not-found.tsx` exist; user-facing errors are
  normalized (`src/lib/errors.ts`).

---

## 7. Deploy procedure

```bash
# 1. CI: migrations (runs before the Amplify release)
#    .github/workflows/deploy-migrations.yml  (DIRECT_URL secret)

# 2. Amplify builds and publishes main

# 3. Smoke test
BASE_URL=https://app.example.com \
SMOKE_COOKIE="__Secure-next-auth.session-token=<value>" \
node scripts/smoke-test.mjs
```

Smoke test covers: health + DB ping, security headers, login page, 401 on
unauthenticated API, and (with a cookie) workspace/projects/notifications.

Manual pass after deploy: sign up → create workspace → project → case → suite →
run → execute a case → one AI action → connect an integration.

### Rollback

1. Amplify → App → Deployments → redeploy the previous successful build.
2. If a migration already ran, the previous build may be incompatible: prefer a
   forward fix; otherwise restore the pre-deploy snapshot.
3. Confirm `/api/health` and the smoke test after rollback.

---

## 8. Deferred to post-launch (deliberately)

- **Biggest remaining perf item**: `src/app/(main)/p/[slug]/layout.tsx` loads the
  whole project on every project page render — `getTestCases()` (all cases plus
  all their steps), archived cases, all suites with their cases and `getTestRuns()`
  (all runs plus all results). At 10k cases / 100k results this dominates TTFB.
  Fix: server-side pagination for the repository table and a client cache
  (TanStack Query) for the cockpit, keeping the layout to counts + the first page.
  Not changed here because it is a data-contract change across many pages.
- Frontend request de-duplication and `ExecutionConsole` effect cleanup: verify
  duplicates on a **production build** first (React StrictMode double-invokes
  effects in dev only). Prefer TanStack Query/SWR over a Server Component rewrite
  of an interactive cockpit.
- Bundle splitting of the cockpit/editor.
- Redis-backed rate limiting, distributed AI quotas.
- Nonce-based CSP.
- Audit log single write path (dual write between `ActivityLog` and `AuditLog`
  still exists; pick one append-only path).
