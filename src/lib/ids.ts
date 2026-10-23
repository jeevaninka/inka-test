import { prisma } from '@/lib/db';

async function nextVal(sequence: string): Promise<number> {
  const rows = await prisma.$queryRawUnsafe<{ nextval: number }[]>(
    `SELECT nextval('${sequence}') AS nextval`
  );
  return Number(rows[0].nextval);
}

export async function generateWorkspaceId(): Promise<string> {
  const n = await nextVal('workspace_seq');
  return `WS-${n}`;
}

export async function generateProjectId(): Promise<string> {
  const n = await nextVal('project_seq');
  return `PRJ-${n}`;
}

export async function generateTestCaseDisplayId(projectId: string): Promise<string> {
  const project = await prisma.project.update({
    where: { id: projectId },
    data: { case_counter: { increment: 1 } },
    select: { key: true, case_counter: true },
  });
  const cleanKey = (project.key || 'PRJ').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 4) || 'PRJ';
  return `${cleanKey}-${project.case_counter}`;
}

export async function generateTestSuiteId(): Promise<string> {
  const n = await nextVal('test_suite_seq');
  return `TS-${n}`;
}

export async function generateTestRunId(): Promise<string> {
  const n = await nextVal('test_run_seq');
  return `RUN-${n}`;
}

export async function generateDefectId(): Promise<string> {
  const n = await nextVal('defect_seq');
  return `DEF-${n}`;
}
