import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Server Actions Authorization Guardrail', () => {
  const actionsDir = path.resolve(process.cwd(), 'src/app/actions');
  const actionFiles = fs.readdirSync(actionsDir).filter((f) => f.endsWith('.ts'));

  it('scans all server action files and ensures they contain authorization checks', () => {
    expect(actionFiles.length).toBeGreaterThan(10);

    for (const file of actionFiles) {
      const content = fs.readFileSync(path.join(actionsDir, file), 'utf-8');

      // Every file in src/app/actions must be a server action file
      expect(content).toContain("'use server'");

      // Extract all exported async functions
      const exportedFunctions = Array.from(content.matchAll(/export\s+async\s+function\s+([A-Za-z0-9_]+)/g)).map(
        (m) => m[1]
      );

      expect(exportedFunctions.length).toBeGreaterThan(0);

      // Verify that every action file imports auth or permissions utilities
      const hasAuthImport =
        content.includes('getServerSession') ||
        content.includes('authorizedAction') ||
        content.includes('getAuthorizedUser') ||
        content.includes('requireProjectMember') ||
        content.includes('requireWorkspaceMember');

      expect(
        hasAuthImport,
        `File ${file} does not import any session or permission authorization utilities!`
      ).toBe(true);
    }
  });

  it('verifies updateWorkspaceMemberRoleAction enforces owner or admin checks', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'workspace.ts'), 'utf-8');
    expect(content).toContain("currentMember.role !== 'OWNER' && currentMember.role !== 'ADMIN'");
  });

  it('verifies acceptInvitationAction enforces recipient email binding', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'workspace.ts'), 'utf-8');
    expect(content).toContain('invitation.email.toLowerCase().trim() !== user.email.toLowerCase().trim()');
  });

  it('verifies actions/steps.ts enforces project and tenant permissions', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'steps.ts'), 'utf-8');
    expect(content).toContain('requireProjectViewer');
    expect(content).toContain('requireProjectMember');
    expect(content).toContain('requireProjectMemberByStepId');
    expect(content).toContain('requireProjectMemberByReusableStepId');
  });

  it('verifies actions/modules.ts enforces project membership', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'modules.ts'), 'utf-8');
    expect(content).toContain('requireProjectMember');
  });

  it('verifies actions/webhooks.ts enforces admin permissions on mutating actions', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'webhooks.ts'), 'utf-8');
    expect(content).toContain('requireWorkspaceAdmin');
    expect(content).toContain('requireProjectAdmin');
  });

  it('verifies permanent suite deletion requires a project admin', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'suites.ts'), 'utf-8');
    const start = content.indexOf('export async function deleteTestSuiteAction');
    const deleteAction = content.slice(start, content.indexOf('export async function', start + 1));
    expect(deleteAction).toContain('requireProjectAdmin');
    expect(deleteAction).not.toContain('requireProjectMember(');
  });

  it('verifies permanent run deletion requires a project admin', () => {
    const content = fs.readFileSync(path.join(actionsDir, 'runs.ts'), 'utf-8');
    const start = content.indexOf('export async function bulkDeleteRunsAction');
    const deleteAction = content.slice(start, content.indexOf('export async function', start + 1));
    expect(deleteAction).toContain('requireProjectAdmin');
    expect(deleteAction).not.toContain('requireProjectMember(');
  });

  it('verifies destructive delete dialogs require typing DELETE', () => {
    const confirmModal = fs.readFileSync(
      path.resolve(process.cwd(), 'src/components/common/ConfirmModal.tsx'),
      'utf-8'
    );
    expect(confirmModal).toContain('requireTypedConfirmation');
    expect(confirmModal).toContain('disabled={disabled || !typedConfirmationMatches}');

    const destructiveScreens = [
      'src/app/(main)/p/[slug]/suites/page.tsx',
      'src/app/(main)/p/[slug]/runs/RunsClient.tsx',
      'src/app/(main)/p/[slug]/repository/CaseDetailView.tsx',
    ];
    for (const screen of destructiveScreens) {
      const content = fs.readFileSync(path.resolve(process.cwd(), screen), 'utf-8');
      expect(content, `${screen} must require typed DELETE confirmation`).toContain(
        'requireTypedConfirmation="DELETE"'
      );
    }
  });
});
