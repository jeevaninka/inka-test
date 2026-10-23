import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

/**
 * Cross-tenant regression guard.
 *
 * These are static assertions on purpose: they run without a database and fail
 * loudly if someone removes the tenant check from a server action. A leak here
 * is a breach, not a bug, so it is worth pinning in CI.
 */

function read(relative: string): string {
  return fs.readFileSync(path.resolve(process.cwd(), relative), 'utf-8');
}

function actionBody(source: string, name: string): string {
  const start = source.indexOf(`export async function ${name}`);
  expect(start, `${name} not found`).toBeGreaterThan(-1);
  const next = source.indexOf('export async function', start + 1);
  return source.slice(start, next === -1 ? undefined : next);
}

describe('run actions are tenant scoped', () => {
  const runs = read('src/app/actions/runs.ts');

  it('getRunResultsAction authorises the run before reading results', () => {
    expect(actionBody(runs, 'getRunResultsAction')).toContain('requireProjectMemberByRunId');
  });

  it('getRunResultStepsAction authorises the result before reading steps', () => {
    expect(actionBody(runs, 'getRunResultStepsAction')).toContain('requireProjectMemberByRunResultId');
  });

  it('skipRemainingRunCasesAction authorises the run', () => {
    expect(actionBody(runs, 'skipRemainingRunCasesAction')).toContain('requireProjectMemberByRunId');
  });

  it('validateRunPlanAction authorises the project and scopes case lookup', () => {
    const body = actionBody(runs, 'validateRunPlanAction');
    expect(body).toContain('requireProjectMember');
    expect(body).toContain('project_id: actualProjectId');
  });
});

describe('comment actions require project membership', () => {
  const comments = read('src/app/actions/comments.ts');

  it('updateCommentAction re-checks project membership', () => {
    expect(actionBody(comments, 'updateCommentAction')).toContain('requireProjectMember');
  });

  it('deleteCommentAction re-checks project membership', () => {
    expect(actionBody(comments, 'deleteCommentAction')).toContain('requireProjectMember');
  });

  it('createCommentAction rejects entities from another project', () => {
    const body = actionBody(comments, 'createCommentAction');
    expect(body).toContain('resolveEntityProjectId');
    expect(body).toContain('does not belong to this project');
  });
});

describe('suite actions require project membership', () => {
  const suites = read('src/app/actions/suites.ts');

  it('removeCaseFromSuiteAction authorises the suite', () => {
    const body = actionBody(suites, 'removeCaseFromSuiteAction');
    expect(body).toContain('requireProjectMemberBySuiteId');
    expect(body).toContain('testCase.project_id !== suiteProjectId');
  });

  it('reorderSuiteCasesAction authorises the suite', () => {
    expect(actionBody(suites, 'reorderSuiteCasesAction')).toContain('requireProjectMemberBySuiteId');
  });
});

describe('execution control actions require project membership', () => {
  const integrations = read('src/app/actions/integrations.ts');

  for (const name of [
    'startExternalRunCasesAction',
    'resumeExternalRunCasesAction',
    'rerunRunCasesAction',
    'stopRunExecutionAction',
    'executeRunCaseAction',
    'executeExternalRunAction',
  ]) {
    it(`${name} authorises the run`, () => {
      expect(actionBody(integrations, name)).toContain('requireProjectMemberByRunId');
    });
  }
});

describe('bulk actions cannot cross tenants', () => {
  const cases = read('src/app/actions/cases.ts');
  const reviews = read('src/app/actions/reviews.ts');

  it('bulkAddTagsAction authorises every involved project', () => {
    expect(actionBody(cases, 'bulkAddTagsAction')).toContain('requireProjectMember');
  });

  it('bulkAdminForceApproveAction requires project admin per project', () => {
    const body = actionBody(reviews, 'bulkAdminForceApproveAction');
    expect(body).toContain('requireProjectAdmin');
    expect(body).not.toContain('session.user as any).role');
  });
});

describe('DAL readers require an explicit tenant scope', () => {
  const dal = read('src/lib/dal/projects.ts');

  it('getTestCaseById takes a scope and filters on it', () => {
    const body = actionBody(dal, 'getTestCaseById');
    expect(body).toContain('scope: { projectId?: string; workspaceId?: string }');
    expect(body).toContain('project_id: scope.projectId');
    expect(body).not.toContain('findUnique');
  });

  it('getTestRunById takes a scope and filters on it', () => {
    const body = actionBody(dal, 'getTestRunById');
    expect(body).toContain('scope: { projectId?: string; workspaceId?: string }');
    expect(body).toContain('project_id: scope.projectId');
  });
});

describe('attachment upload cannot target another tenant', () => {
  const route = read('src/app/api/v1/attachments/upload/route.ts');

  it('verifies project membership before creating an attachment', () => {
    expect(route).toContain('requireProjectMember');
    expect(route).toContain('actualProjectId');
  });
});
