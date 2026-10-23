export type Role = 'admin' | 'tester' | 'viewer';
export type Priority = 'P0' | 'P1' | 'P2' | 'P3';
export type CaseType = 'manual' | 'auto';
export type CaseStatus = 'active' | 'draft' | 'deprecated';
export type SuiteType = 'smoke' | 'regression' | 'sprint' | 'custom';
export type RunStatus = 'in_progress' | 'completed' | 'failed' | 'aborted';
export type ResultStatus = 'pass' | 'fail' | 'error' | 'blocked' | 'skip' | 'pending' | 'invalid' | 'unavailable' | 'cancelled';
export type CustomFieldType = 'TEXT' | 'DROPDOWN' | 'MULTI_SELECT' | 'BOOLEAN' | 'NUMBER' | 'URL';
export type CustomFieldEntityType = 'TEST_CASE' | 'TEST_RUN' | 'RELEASE' | 'DEFECT';

export interface CustomFieldDefinitionItem {
  id: string;
  projectId: string;
  entityType: CustomFieldEntityType;
  name: string;
  key: string;
  type: CustomFieldType;
  description?: string | null;
  options?: string[] | null;
  defaultVal?: any;
  required: boolean;
  order: number;
  createdAt: string;
  updatedAt: string;
}

export interface User {
  id: string;
  name: string;
  email: string;
  avatarUrl?: string;
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  aiEnabled: boolean;
  reviewRequired: boolean;
  createdBy: string;
  createdAt: string;
}

export interface ProjectMember {
  projectId: string;
  userId: string;
  role: Role;
}

export interface Module {
  id: string;
  projectId: string;
  name: string;
  parentId: string | null;
  orderIndex: number;
}

export interface StepItem {
  id: string;
  order: number;
  step: string;
  expected_result: string | null;
  data: string | null;
  /** Compact provider metadata (Datadog stepId/badges/subtest group). */
  meta?: string | null;
  image_url: string | null;
  reusable_step_id: string | null;
  reusable_step_item_id: string | null;
  is_outdated: boolean;
  ai_generated?: boolean;
  reusable_step?: {
    id: string;
    title: string;
    step: string;
    expected_result: string | null;
    data: string | null;
    steps: any[];
    _count?: { test_case_steps: number };
  } | null;
  needsUpdate?: boolean;
}

export interface TestCase {
  id: string;
  displayId: string;
  projectId: string;
  moduleId: string | null;
  title: string;
  description?: string;
  preConditions?: string;
  postConditions?: string;
  steps: StepItem[];
  expectedResult?: string;
  priority: Priority;
  type: CaseType;
  status: CaseStatus;
  tags: string[];
  labels: string[];
  scenarioType?: string;
  customFields?: Record<string, any>;
  custom_fields?: Record<string, any>;
  aiGenerated: boolean;
  needsUpdate: boolean;
  reviewStatus?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
  updatedBy?: string;
}

export interface TestSuite {
  id: string;
  projectId: string;
  name: string;
  type: SuiteType;
  environment?: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface SuiteCase {
  suiteId: string;
  testCaseId: string;
  orderIndex: number;
}

export interface TestRun {
  id: string;
  projectId: string;
  suiteId?: string;
  name: string;
  environment: string;
  buildVersion?: string;
  assignedTo?: string;
  status: RunStatus;
  startedAt?: string;
  completedAt?: string;
  createdBy: string;
  createdAt: string;
}

export interface RunResult {
  id: string;
  runId: string;
  testCaseId: string;
  orderIndex: number;
  status: ResultStatus;
  notes?: string;
  evidenceUrl?: string;
  executedBy?: string;
  executedAt?: string;
  attemptNumber?: number;
  timeSpentSeconds?: number;
  totalTimeSpentSeconds?: number;
  totalAttempts?: number;
  attempts?: Array<{ attemptNumber: number; timeSpentSeconds: number; status: string }>;
}

export interface Defect {
  id: string;
  runResultId: string;
  testCaseId: string;
  ticketUrl?: string;
  externalTicketId?: string;
  ticketStatus?: string;
  raisedBy: string;
  raisedAt: string;
  updatedAt: string;
}

export interface ActivityLogEntry {
  id: string;
  projectId: string;
  userId: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
}

export interface AiCallRecord {
  id: string;
  projectId: string;
  userId: string;
  feature: 'generate_cases' | 'generate_defect' | 'clean_note' | 'improve_steps';
  status: 'success' | 'validation_failed' | 'error' | 'quota_exceeded';
  inputChars: number;
  outputChars?: number;
  durationMs?: number;
  accepted?: boolean;
  createdAt: string;
}
