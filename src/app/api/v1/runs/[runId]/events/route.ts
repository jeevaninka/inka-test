import { NextRequest } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { requireProjectMemberByRunId } from '@/lib/permissions';
import { subscribeRunEvents } from '@/lib/execution/events';
import { computeQueuePositions, deriveRunLifecycle, latestAttempts } from '@/lib/execution/state';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Authenticated Server-Sent Events stream for one run.
 *
 * The database is authoritative: each event is an invalidation hint plus a
 * sequence number, and the client always refetches the persisted snapshot on a
 * gap or reconnect. A snapshot is also emitted every 15s so multi-instance
 * deployments (where the in-process bus is not shared) stay correct.
 */
export async function GET(
  request: NextRequest,
  context: { params: Promise<{ runId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return new Response('Unauthorized', { status: 401 });
  }
  const { runId } = await context.params;
  const userId = (session.user as any).id as number;

  try {
    await requireProjectMemberByRunId(runId, userId, 'VIEWER');
  } catch {
    return new Response('Forbidden', { status: 403 });
  }

  const encoder = new TextEncoder();

  const buildSnapshot = async () => {
    const run: any = await prisma.testRun.findUnique({
      where: { id: runId },
      select: {
        id: true,
        status: true,
        stop_requested_at: true,
        execution_generation: true,
        results: {
          orderBy: [{ order_index: 'asc' }, { attempt_number: 'asc' }],
          select: {
            id: true,
            test_case_id: true,
            order_index: true,
            attempt_number: true,
            status: true,
            execution_state: true,
            provider_execution_id: true,
            updated_at: true,
            last_execution_error: true,
          },
        },
      },
    });
    if (!run) return null;
    const rows: any[] = run.results || [];
    const latest: any[] = latestAttempts(rows);
    const positions = computeQueuePositions(latest as any);
    const maxUpdated = rows.reduce(
      (max: number, row: any) => Math.max(max, row.updated_at?.getTime() || 0),
      0
    );
    return {
      runId,
      lifecycle: deriveRunLifecycle(run, latest as any),
      status: String(run.status || '').toLowerCase(),
      generation: run.execution_generation,
      stopRequestedAt: run.stop_requested_at?.toISOString() ?? null,
      version: `${maxUpdated}:${rows.length}:${run.status}:${
        run.stop_requested_at?.getTime() || 0
      }:${run.execution_generation}`,
      results: latest.map((row: any) => ({
        id: row.id,
        testCaseId: row.test_case_id,
        orderIndex: row.order_index,
        attemptNumber: row.attempt_number,
        status: String(row.status || '').toLowerCase(),
        executionState: row.execution_state,
        queuePosition: positions[row.id] ?? null,
        providerExecutionId: row.provider_execution_id,
        error: row.last_execution_error,
        updatedAt: row.updated_at?.toISOString() ?? null,
      })),
    };
  };

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let closed = false;
      const send = (event: string, data: unknown, id?: number) => {
        if (closed) return;
        try {
          const lines = [
            ...(id !== undefined ? [`id: ${id}`] : []),
            `event: ${event}`,
            `data: ${JSON.stringify(data)}`,
            '',
            '',
          ];
          controller.enqueue(encoder.encode(lines.join('\n')));
        } catch {
          closed = true;
        }
      };

      const emitSnapshot = async () => {
        try {
          const snapshot = await buildSnapshot();
          if (snapshot) send('snapshot', snapshot);
        } catch {
          // transient DB error: keep the stream alive; client keeps polling
        }
      };

      send('ready', { runId, at: new Date().toISOString() });
      await emitSnapshot();

      const unsubscribe = subscribeRunEvents(runId, (event) => {
        send('execution', event, event.seq);
        // Coalesce: a snapshot after each event gives the client the persisted
        // truth even if it missed an earlier event.
        void emitSnapshot();
      });

      const heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`: keepalive ${Date.now()}\n\n`));
        } catch {
          closed = true;
        }
      }, 15_000);

      const snapshots = setInterval(() => void emitSnapshot(), 15_000);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        clearInterval(snapshots);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
