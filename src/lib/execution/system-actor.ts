/**
 * Process-local activation tokens for system-initiated execution.
 *
 * The client-facing server action (`executeTestCaseExternalRunnerAction`) must
 * keep requiring a NextAuth session. Server-side workers have no HTTP session,
 * so the coordinator passes a token object that exists only in this process.
 * A token cannot be forged over the wire: server-action arguments arrive as
 * freshly deserialized objects, which are never members of this WeakSet.
 */
const activeSystemActors = new WeakSet<object>();

export interface SystemActor {
  userId: number;
  reason: string;
}

export function createSystemActor(userId: number, reason = 'execution-coordinator'): SystemActor {
  const actor: SystemActor = { userId, reason };
  activeSystemActors.add(actor);
  return actor;
}

export function readSystemActor(value: unknown): SystemActor | null {
  if (!value || typeof value !== 'object') return null;
  return activeSystemActors.has(value as object) ? (value as SystemActor) : null;
}
