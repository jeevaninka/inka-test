import type { Prisma, PrismaClient } from '@prisma/client';

type Db = PrismaClient | Prisma.TransactionClient;

/**
 * Content fields that make a test case materially different. A change to any of
 * them creates a new immutable version so a run can tell that the case it
 * executed is no longer the case in the repository.
 */
export const CASE_CONTENT_FIELDS = [
  'title',
  'description',
  'preConditions',
  'postConditions',
  'expectedResult',
  'customFields',
  'custom_fields',
] as const;

/**
 * Snapshot the *current* content of a case as a new immutable version and bump
 * `current_version`.
 *
 * Runs lock themselves to a version at creation time (`RunResult.test_version_id`).
 * Comparing that version with `current_version` is what powers the
 * "Case updated since added" badge in the run deck.
 *
 * Safe to call from inside a transaction; pass `tx` so the snapshot and the
 * content update commit together.
 */
export async function snapshotTestCaseVersion(
  db: Db,
  testCaseId: string,
  userId: number
): Promise<number | null> {
  const tc = await db.testCase.findUnique({
    where: { id: testCaseId },
    select: {
      current_version: true,
      description: true,
      pre_conditions: true,
      post_conditions: true,
      expected_result: true,
      test_case_steps: {
        orderBy: { order: 'asc' },
        select: {
          order: true,
          step: true,
          expected_result: true,
          data: true,
          meta: true,
        },
      },
    },
  });
  if (!tc) return null;

  const nextVersion = (tc.current_version || 1) + 1;

  await db.testCaseVersion.create({
    data: {
      test_case_id: testCaseId,
      version_number: nextVersion,
      steps: tc.test_case_steps.map((s) => ({
        order: s.order,
        step: s.step,
        expectedResult: s.expected_result,
        data: s.data,
        meta: s.meta,
      })) as any,
      description: tc.description,
      pre_conditions: tc.pre_conditions,
      snapshot_by: userId,
    },
  });

  await db.testCase.update({
    where: { id: testCaseId },
    data: { current_version: nextVersion },
  });

  return nextVersion;
}

/** True when an update payload touches case content (not just status/flags). */
export function touchesCaseContent(data: Record<string, unknown>): boolean {
  return CASE_CONTENT_FIELDS.some((field) => data[field] !== undefined);
}

/**
 * The version a run should lock to when a case is added. Returns the newest
 * snapshot id, creating v1 when the case somehow has no snapshot yet.
 */
export async function resolveSnapshotVersionId(
  db: Db,
  testCaseId: string,
  userId: number
): Promise<string | null> {
  const latest = await db.testCaseVersion.findFirst({
    where: { test_case_id: testCaseId },
    orderBy: { version_number: 'desc' },
    select: { id: true },
  });
  if (latest) return latest.id;

  const tc = await db.testCase.findUnique({
    where: { id: testCaseId },
    select: { id: true, description: true, pre_conditions: true },
  });
  if (!tc) return null;

  const steps = await db.testCaseStep.findMany({
    where: { test_case_id: testCaseId },
    orderBy: { order: 'asc' },
    select: { order: true, step: true, expected_result: true, data: true, meta: true },
  });

  const created = await db.testCaseVersion.create({
    data: {
      test_case_id: testCaseId,
      version_number: 1,
      steps: steps.map((s) => ({
        order: s.order,
        step: s.step,
        expectedResult: s.expected_result,
        data: s.data,
        meta: s.meta,
      })) as any,
      description: tc.description,
      pre_conditions: tc.pre_conditions,
      snapshot_by: userId,
    },
  });
  await db.testCase.update({ where: { id: testCaseId }, data: { current_version: 1 } });
  return created.id;
}
