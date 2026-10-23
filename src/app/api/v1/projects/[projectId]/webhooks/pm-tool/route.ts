import { NextRequest } from 'next/server';
import { POST as handleIncomingWebhook } from '../incoming/route';

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ projectId: string }> }
) {
  return handleIncomingWebhook(req, ctx);
}
