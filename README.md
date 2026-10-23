# InkaTest — QA Intelligence & Test Case Management Platform

InkaTest (InkaQA) is an AI-powered, multi-tenant QA Intelligence & Test Case Management platform built with **Next.js 16 (App Router)**, **React 19**, **TypeScript**, **PostgreSQL + Prisma**, **NextAuth.js**, **Google Gemini (`gemini-2.5-flash`)**, **AWS S3**, and **AWS SES**.

For complete architecture, database schema, route specifications, and AWS Amplify deployment instructions, see **[PLAN.md](./PLAN.md)**.
For the production readiness checklist (env vars, pooling, migrations, smoke test, rollback), see **[DEPLOY.md](./DEPLOY.md)**.

---

## Quick Start (Local Development)

### 1. Prerequisites
- **Node.js** 20+ (v22 recommended)
- **pnpm** 9+ / 10+ (`corepack enable`)
- **PostgreSQL** 14+
- *(Optional)* Local S3-compatible storage (MinIO / LocalStack) and local SMTP server (Mailpit / Mailhog)

### 2. Environment Setup
Copy `.env.example` to `.env.local` and fill in your local credentials:

```bash
cp .env.example .env.local
```

### 3. Install Dependencies & Initialize Database
```bash
pnpm install
pnpm db:migrate:deploy   # or pnpm db:push for rapid local prototyping
```

### 4. Start Development Server
```bash
pnpm dev
```
Open [http://localhost:3002](http://localhost:3002) in your browser.

---

## Available Scripts

| Command | Description |
|---|---|
| `pnpm dev` | Start Next.js development server on port `3002` |
| `pnpm build` | Generate Prisma Client and build production Next.js bundle |
| `pnpm start` | Start production server |
| `pnpm test` | Run Vitest unit & security test suites |
| `pnpm lint` | Run ESLint checks |
| `pnpm db:generate` | Generate Prisma Client (`prisma generate`) |
| `pnpm db:migrate:dev` | Create and apply a new Prisma migration locally (`prisma migrate dev`) |
| `pnpm db:migrate:deploy` | Apply pending migrations in staging/production (`prisma migrate deploy`) |
| `pnpm db:migrate:resolve` | Resolve failed or baselined migrations (`prisma migrate resolve`) |
| `pnpm db:push` | Push Prisma schema directly to DB without migration files (`prisma db push`) |

---

## Project Structure

```text
├── amplify.yml              # AWS Amplify Hosting SSR build & migration specification
├── PLAN.md                  # Full architecture, data model, route map & deployment runbook
├── .env.example             # Documented environment variable template
├── prisma/
│   ├── schema.prisma        # PostgreSQL Prisma schema (31 models, 15 enums)
│   ├── migrations/          # Versioned SQL migrations for prisma migrate deploy
│   └── scripts/             # Database maintenance & data migration scripts
├── src/
│   ├── proxy.ts             # Next.js 16 auth & tenant routing middleware
│   ├── app/
│   │   ├── (auth)/login/    # Login & authentication views
│   │   ├── (main)/          # Authenticated routes (org, workspace, project, platform-admin)
│   │   ├── actions/         # Server Actions (cases, runs, suites, releases, AI, webhooks, etc.)
│   │   ├── api/             # Route Handlers (/api/health, /api/auth, /api/v1/*)
│   │   ├── invite/          # Token-based invitation acceptance flow
│   │   └── pending/         # Account approval holding page
│   ├── components/          # UI components (cases, configuration, layout, reviews, runs, settings, ui)
│   ├── hooks/               # Custom React hooks (useTheme)
│   └── lib/                 # Core services (ai, auth, dal, email, integrations, network, notifications, s3)
└── tests/                   # Vitest unit, integration & security tests
```
