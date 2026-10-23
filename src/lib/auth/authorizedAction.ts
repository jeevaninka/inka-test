import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import {
  requireProjectViewer,
  requireProjectMember,
  requireProjectAdmin,
  requireWorkspaceMember,
  requireWorkspaceAdmin,
} from '@/lib/permissions';
import { runLoggedAction } from '@/lib/logger';
import { AppError, ErrorCodes } from '@/lib/errors';

export type RequiredRole = 'VIEWER' | 'MEMBER' | 'ADMIN' | 'OWNER';

export interface ActionContext {
  userId: number;
  user: any;
  projectId?: string;
  workspaceId?: string;
}

export function createAuthorizedAction<TInput, TOutput>(
  options: {
    module?: string;
    action?: string;
    resolveScope?: (input: TInput, userId: number) => Promise<{ projectId?: string; workspaceId?: string }>;
    requiredRole?: RequiredRole;
    requireApproved?: boolean;
  },
  handler: (input: TInput, ctx: ActionContext) => Promise<TOutput>
) {
  const moduleName = options.module || 'AuthorizedAction';
  const actionName = options.action || handler.name || 'execute';

  return async (input: TInput): Promise<TOutput> => {
    return runLoggedAction(moduleName, actionName, { logSuccess: true }, async () => {
      const session = await getServerSession(authOptions);
      if (!session?.user) {
        throw new AppError('Unauthorized', ErrorCodes.UNAUTHORIZED);
      }

      const userId = Number((session.user as any).id);
      const isApproved = Boolean((session.user as any).isApproved);

      if (options.requireApproved !== false && !isApproved) {
        throw new AppError('Forbidden: Account pending approval', ErrorCodes.PENDING_APPROVAL);
      }

      let scope: { projectId?: string; workspaceId?: string } = {};
      if (options.resolveScope) {
        scope = await options.resolveScope(input, userId);
        const role = options.requiredRole || 'MEMBER';

        if (scope.projectId) {
          if (role === 'VIEWER') {
            await requireProjectViewer(scope.projectId, userId);
          } else if (role === 'ADMIN' || role === 'OWNER') {
            await requireProjectAdmin(scope.projectId, userId);
          } else {
            await requireProjectMember(scope.projectId, userId);
          }
        } else if (scope.workspaceId) {
          if (role === 'ADMIN' || role === 'OWNER') {
            await requireWorkspaceAdmin(scope.workspaceId, userId);
          } else {
            await requireWorkspaceMember(scope.workspaceId, userId);
          }
        }
      }

      return handler(input, {
        userId,
        user: session.user,
        projectId: scope.projectId,
        workspaceId: scope.workspaceId,
      });
    });
  };
}
