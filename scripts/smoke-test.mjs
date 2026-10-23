#!/usr/bin/env node
/**
 * Post-deploy smoke test.
 *
 * Usage:
 *   BASE_URL=https://app.example.com node scripts/smoke-test.mjs
 *   BASE_URL=... SMOKE_COOKIE="__Secure-next-auth.session-token=..." node scripts/smoke-test.mjs
 *
 * Without SMOKE_COOKIE only the anonymous checks run (health, auth redirect,
 * security headers). With a cookie the authenticated checks run too.
 *
 * Exit code 0 = all checks passed, 1 = at least one failed.
 */

const BASE_URL = (process.env.BASE_URL || 'http://localhost:3002').replace(/\/+$/, '');
const COOKIE = process.env.SMOKE_COOKIE || '';

const results = [];

async function check(name, fn) {
  const started = Date.now();
  try {
    const detail = await fn();
    results.push({ name, ok: true, ms: Date.now() - started, detail });
  } catch (error) {
    results.push({ name, ok: false, ms: Date.now() - started, detail: error.message });
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function req(path, options = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    redirect: 'manual',
    ...options,
    headers: { ...(COOKIE ? { cookie: COOKIE } : {}), ...(options.headers || {}) },
  });
  return res;
}

await check('health endpoint reports DB connectivity', async () => {
  const res = await req('/api/health');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  const body = await res.json();
  assert(body.status === 'ok', `status=${body.status}`);
  assert(body.database === 'connected', 'database not connected');
  return `db latency ${body.latencyMs}ms`;
});

await check('security headers present', async () => {
  const res = await req('/');
  const required = [
    'content-security-policy',
    'x-frame-options',
    'x-content-type-options',
    'strict-transport-security',
    'referrer-policy',
  ];
  const missing = required.filter((h) => !res.headers.get(h));
  assert(missing.length === 0, `missing headers: ${missing.join(', ')}`);
  return required.length + ' headers';
});

await check('login page renders', async () => {
  const res = await req('/login');
  assert(res.status === 200, `expected 200, got ${res.status}`);
  return 'ok';
});

await check('unauthenticated API access is rejected', async () => {
  const res = await req('/api/v1/projects');
  assert(res.status === 401 || res.status === 403, `expected 401/403, got ${res.status}`);
  return `status ${res.status}`;
});

if (COOKIE) {
  await check('workspaces endpoint returns data for the session', async () => {
    const res = await req('/api/v1/workspaces/active');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(body && body.id, 'no workspace returned');
    return body.slug;
  });

  await check('projects endpoint returns a list', async () => {
    const res = await req('/api/v1/projects');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    const list = Array.isArray(body) ? body : body.projects;
    assert(Array.isArray(list), 'unexpected payload shape');
    return `${list.length} project(s)`;
  });

  await check('notifications endpoint responds', async () => {
    const res = await req('/api/v1/notifications?countOnly=true');
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const body = await res.json();
    assert(typeof body.unreadCount === 'number', 'missing unreadCount');
    return `unread ${body.unreadCount}`;
  });
}

const failed = results.filter((r) => !r.ok);
for (const r of results) {
  console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name} (${r.ms}ms)${r.ok ? ` — ${r.detail}` : `\n      ${r.detail}`}`);
}
console.log(`\n${results.length - failed.length}/${results.length} checks passed against ${BASE_URL}`);
process.exit(failed.length === 0 ? 0 : 1);
