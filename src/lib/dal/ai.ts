import { prisma } from '@/lib/db';
import type { ExploratorySession, AiSuggestion } from '@prisma/client';

// ==========================================
// AI CALL LOGGING
// ==========================================

export async function logAiCall(data: {
  project_id: string;
  user_id: number;
  feature: string;
  provider: string;
  model: string;
  prompt_version: string;
  input_chars: number;
  output_chars?: number;
  duration_ms?: number;
  status: string;
  error_message?: string;
  accepted?: boolean;
}) {
  return prisma.aiCall.create({ data });
}

// ==========================================
// AI SUGGESTIONS
// ==========================================

export async function getAiSuggestions(projectId: string) {
  return prisma.aiSuggestion.findMany({
    where: { project_id: projectId },
    orderBy: { created_at: 'desc' },
    include: { test_case: true },
  });
}

export async function createAiSuggestion(data: {
  project_id: string;
  suggestion_type: 'SELF_HEAL' | 'NEW_TEST_CASE' | 'DEDUP_DEFECT';
  payload: Record<string, unknown>;
  test_case_id?: string;
  run_result_id?: string;
}) {
  return prisma.aiSuggestion.create({
    data: data as any,
  });
}

export async function updateAiSuggestionStatus(
  id: string,
  status: 'PENDING' | 'APPROVED' | 'REJECTED',
  reviewedBy: number
) {
  return prisma.aiSuggestion.update({
    where: { id },
    data: {
      status,
      reviewed_by: reviewedBy,
      reviewed_at: new Date(),
    },
  });
}

// ==========================================
// EXPLORATORY SESSIONS
// ==========================================

export async function getExploratorySessions(projectId: string) {
  return prisma.exploratorySession.findMany({
    where: { project_id: projectId },
    orderBy: { started_at: 'desc' },
  });
}

export async function createExploratorySession(data: {
  project_id: string;
  title: string;
  charter?: string;
  raw_notes: string;
  tester_id: number;
}) {
  return prisma.exploratorySession.create({
    data,
  });
}

export async function endExploratorySession(sessionId: string, aiSummary: Record<string, unknown>) {
  return prisma.exploratorySession.update({
    where: { id: sessionId },
    data: {
      ended_at: new Date(),
      ai_summary: aiSummary as any,
    },
  });
}
