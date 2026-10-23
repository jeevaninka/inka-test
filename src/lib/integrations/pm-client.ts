import { prisma } from '@/lib/db';
import { getBaseUrl } from '@/lib/config';
import { decrypt } from '@/lib/crypto';
import { validateDestinationUrl } from '@/lib/network/ssrf-guard';
import { logger } from '@/lib/logger';
import { ErrorCodes } from '@/lib/errors';

export interface PmSpace {
  id: string;
  name: string;
  key?: string;
  description?: string;
  custom_priorities?: PmPriority[];
}

export interface PmPriority {
  id: string;
  name: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  color?: string;
  icon?: string;
  order?: number;
}

export interface PmReleaseItem {
  id: string;
  name: string;
  versionTag?: string;
  releaseDate?: string;
  status?: string;
  ticketCount?: number;
}

export interface PmReleaseDetail {
  id: string;
  name: string;
  versionTag?: string;
  releaseDate?: string;
  status?: string;
  description?: string;
  tickets: Array<{
    id?: string;
    key: string;
    title: string;
    status: string;
    url?: string;
  }>;
}

export interface PmIntegrationConfig {
  baseUrl: string;
  apiKey: string;
  apiKeyHeader?: string;
  apiKeyPrefix?: string;
  createTicketEndpoint?: string;
  getTicketEndpoint?: string;
  webhookSecret?: string;
  autoCreateDefect?: boolean;
  defaultSpaceId?: string;
  statusMapping?: Record<string, string>;
}

export interface CreateTicketParams {
  title: string;
  description: string;
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  priorityName?: string;
  spaceId?: string;
  spaceKey?: string;
  spaceName?: string;
  testCaseDisplayId?: string;
  testCaseTitle?: string;
  runResultUrl?: string;
  testCaseRunUrl?: string;
  runUrl?: string;
  executionKey?: string;
  testCaseLink?: string;
  runId?: string;
  environment?: string;
  attachmentUrl?: string;
  attachmentFilename?: string;
  attachments?: Array<{ filename: string; url?: string; id?: string }>;
}

export interface CreatedTicketResult {
  id: string;
  key?: string;
  url?: string;
  status?: string;
  rawResponse?: any;
}

export class CustomPmClient {
  private baseUrl: string;
  private apiKey: string;
  private apiKeyHeader: string;
  private apiKeyPrefix: string;

  constructor(config: PmIntegrationConfig) {
    // Sanitize base URL to point to API root (e.g. http://localhost:3000/api/v1)
    let raw = (config.baseUrl || '').trim().replace(/\/+$/, '');
    raw = raw.replace(/\/tickets\/?$/, '').replace(/\/issues\/?$/, '').replace(/\/spaces\/?$/, '');
    this.baseUrl = raw;
    this.apiKey = decrypt((config.apiKey || '').trim());
    this.apiKeyHeader = (config.apiKeyHeader || 'Authorization').trim();
    this.apiKeyPrefix = config.apiKeyPrefix !== undefined ? config.apiKeyPrefix.trim() : 'Bearer';
  }

  private getAuthHeaderValue(): string {
    if (!this.apiKeyPrefix) {
      return this.apiKey;
    }
    return `${this.apiKeyPrefix} ${this.apiKey}`;
  }

  private getHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      [this.apiKeyHeader]: this.getAuthHeaderValue(),
    };
  }

  async testConnection(): Promise<{ success: boolean; message: string; latencyMs?: number; data?: any }> {
    if (!this.baseUrl) {
      throw new Error('Base URL is required');
    }
    if (!this.apiKey) {
      throw new Error('API Key is required');
    }

    await validateDestinationUrl(this.baseUrl);

    const startTime = Date.now();

    try {
      const res = await fetch(`${this.baseUrl}/spaces`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(8000),
      });

      const latencyMs = Date.now() - startTime;

      if (res.status === 401 || res.status === 403) {
        throw new Error(`Authentication failed (HTTP ${res.status}). Please check your API Key.`);
      }

      if (res.ok) {
        return {
          success: true,
          message: `Connected successfully (${latencyMs}ms)`,
          latencyMs,
        };
      }

      const errText = await res.text().catch(() => '');
      throw new Error(`PM Tool responded with HTTP ${res.status}: ${errText || res.statusText}`);
    } catch (err: any) {
      const latencyMs = Date.now() - startTime;
      if (err.message?.includes('Authentication failed')) {
        throw err;
      }
      throw new Error(err.message || `Connection failed after ${latencyMs}ms. Check Base URL.`);
    }
  }

  async getSpaces(): Promise<PmSpace[]> {
    if (!this.baseUrl || !this.apiKey) {
      return [];
    }

    const standardPmPriorities: PmPriority[] = [
      { id: 'urgent', name: 'Urgent', severity: 'CRITICAL', color: 'red' },
      { id: 'high', name: 'High', severity: 'HIGH', color: 'orange' },
      { id: 'medium', name: 'Medium', severity: 'MEDIUM', color: 'yellow' },
      { id: 'low', name: 'Low', severity: 'LOW', color: 'blue' },
    ];

    try {
      const res = await fetch(`${this.baseUrl}/spaces`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(8000),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const list = Array.isArray(data) ? data : data?.data || data?.spaces || [];
        if (Array.isArray(list) && list.length > 0) {
          return list.map((item: any) => {
            const rawPriorities = Array.isArray(item.priorities)
              ? item.priorities
              : Array.isArray(item.custom_priorities)
              ? item.custom_priorities
              : Array.isArray(item.space_priorities)
              ? item.space_priorities
              : null;

            let parsedCustomPriorities: PmPriority[] = standardPmPriorities;

            if (Array.isArray(rawPriorities) && rawPriorities.length > 0) {
              parsedCustomPriorities = rawPriorities
                .filter((p: any) => {
                  const n = String(p.name || p.label || p.id || '').toLowerCase();
                  return n !== 'critical';
                })
                .map((p: any) => {
                  const name = String(p.name || p.label || p.id || 'Priority');
                  const nameLower = name.toLowerCase();
                  let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

                  if (
                    nameLower.includes('urgent') ||
                    nameLower.includes('blocker') ||
                    nameLower.includes('p0') ||
                    nameLower.includes('highest')
                  ) {
                    severity = 'CRITICAL';
                  } else if (nameLower.includes('high') || nameLower.includes('major') || nameLower.includes('p1')) {
                    severity = 'HIGH';
                  } else if (nameLower.includes('low') || nameLower.includes('minor') || nameLower.includes('trivial') || nameLower.includes('p3')) {
                    severity = 'LOW';
                  }

                  return {
                    id: String(p.id || p.key || p.value || severity).toLowerCase(),
                    name,
                    severity,
                    color: p.color || (severity === 'CRITICAL' ? 'red' : severity === 'HIGH' ? 'orange' : severity === 'MEDIUM' ? 'yellow' : 'blue'),
                    icon: p.icon,
                    order: typeof p.order === 'number' ? p.order : undefined,
                  };
                });

              if (parsedCustomPriorities.length === 0) {
                parsedCustomPriorities = standardPmPriorities;
              }
            }

            return {
              id: String(item.id || item.key || item.space_id || item.uuid || item.name),
              name: String(item.name || item.title || item.key || item.id),
              key: item.key || item.prefix || undefined,
              description: item.description || undefined,
              custom_priorities: parsedCustomPriorities,
            };
          });
        }
      }
    } catch (err: any) {
      logger.warn('Failed to fetch spaces from PM tool', {
        module: 'PmClient',
        action: 'getSpaces',
        baseUrl: this.baseUrl,
        reason: err.message,
      });
    }

    return [];
  }

  async getPriorities(spaceKeyOrId?: string): Promise<PmPriority[]> {
    const standardPmPriorities: PmPriority[] = [
      { id: 'urgent', name: 'Urgent', severity: 'CRITICAL', color: 'red' },
      { id: 'high', name: 'High', severity: 'HIGH', color: 'orange' },
      { id: 'medium', name: 'Medium', severity: 'MEDIUM', color: 'yellow' },
      { id: 'low', name: 'Low', severity: 'LOW', color: 'blue' },
    ];

    if (!this.baseUrl || !this.apiKey || !spaceKeyOrId) {
      return standardPmPriorities;
    }

    try {
      const res = await fetch(`${this.baseUrl}/spaces/${encodeURIComponent(spaceKeyOrId)}`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      });

      if (res.ok) {
        const data = await res.json().catch(() => null);
        const spaceObj = data?.data || data;
        const customPriorities = spaceObj?.custom_priorities;

        if (Array.isArray(customPriorities) && customPriorities.length > 0) {
          return customPriorities.map((p: any) => {
            const name = String(p.name || p.label || p.id || 'Priority');
            const nameLower = name.toLowerCase();
            let severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' = 'MEDIUM';

            if (
              nameLower.includes('crit') ||
              nameLower.includes('urgent') ||
              nameLower.includes('blocker') ||
              nameLower.includes('p0') ||
              nameLower.includes('highest')
            ) {
              severity = 'CRITICAL';
            } else if (nameLower.includes('high') || nameLower.includes('major') || nameLower.includes('p1')) {
              severity = 'HIGH';
            } else if (nameLower.includes('low') || nameLower.includes('minor') || nameLower.includes('trivial') || nameLower.includes('p3')) {
              severity = 'LOW';
            }

            return {
              id: String(p.id || p.key || p.value || severity).toLowerCase(),
              name,
              severity,
              color: p.color || (severity === 'CRITICAL' ? 'red' : severity === 'HIGH' ? 'orange' : severity === 'MEDIUM' ? 'yellow' : 'blue'),
              icon: p.icon,
              order: typeof p.order === 'number' ? p.order : undefined,
            };
          });
        }
      }
    } catch {
      // Fall back to standard PM priorities
    }

    return standardPmPriorities;
  }

  async createTicket(params: CreateTicketParams): Promise<CreatedTicketResult> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('PM tool is not configured with Base URL and API Key');
    }

    await validateDestinationUrl(this.baseUrl);

    const priorityMap: Record<string, string> = {
      CRITICAL: 'Urgent',
      HIGH: 'High',
      MEDIUM: 'Medium',
      LOW: 'Low',
    };

    const executionKey =
      params.executionKey ||
      (params.runId && params.testCaseDisplayId
        ? `${params.runId}:${params.testCaseDisplayId}`
        : params.testCaseDisplayId || undefined);

    const testCaseRunUrl = params.testCaseRunUrl || params.runResultUrl;

    const inkatestBaseUrl = getBaseUrl();
    const resolvedAttachments = params.attachments && params.attachments.length > 0
      ? params.attachments.map((a) => {
          const rawUrl = a.url || '';
          const absoluteUrl = rawUrl.startsWith('http') ? rawUrl : `${inkatestBaseUrl}${rawUrl}`;
          return {
            file_name: a.filename || 'Evidence',
            url: absoluteUrl,
            file_path: absoluteUrl,
          };
        })
      : params.attachmentUrl
      ? [
          {
            file_name: params.attachmentFilename || 'Evidence',
            url: params.attachmentUrl.startsWith('http') ? params.attachmentUrl : `${inkatestBaseUrl}${params.attachmentUrl}`,
            file_path: params.attachmentUrl.startsWith('http') ? params.attachmentUrl : `${inkatestBaseUrl}${params.attachmentUrl}`,
          },
        ]
      : [];

    const formattedDescription = params.description || '';

    const payload: any = {
      title: params.title,
      description: formattedDescription,
      space_key: params.spaceKey || undefined,
      space_id: params.spaceId ? (isNaN(Number(params.spaceId)) ? undefined : Number(params.spaceId)) : undefined,
      type: 'bug',
      priority: params.priorityName || priorityMap[params.severity] || 'Medium',
      status: 'To Do',
      test_case_link: testCaseRunUrl || params.testCaseLink || undefined,
      external_system: 'InkaTest',
      external_key: executionKey,
      external_link: testCaseRunUrl
        ? {
            system: 'inkatest',
            key: executionKey,
            url: testCaseRunUrl,
            metadata: {
              execution_key: executionKey,
              run_id: params.runId,
              test_case_id: params.testCaseDisplayId,
              test_case_title: params.testCaseTitle,
              test_case_run_url: testCaseRunUrl,
              run_url: params.runUrl,
              environment: params.environment,
            },
          }
        : undefined,
      metadata: {
        execution_key: executionKey,
        test_case_run_url: testCaseRunUrl,
        run_url: params.runUrl,
        test_case_id: params.testCaseDisplayId || undefined,
        test_case_title: params.testCaseTitle || undefined,
        run_id: params.runId || undefined,
        environment: params.environment || undefined,
      },
      attachments: resolvedAttachments.length > 0 ? resolvedAttachments : undefined,
      attachment_url: params.attachmentUrl || undefined,
    };

    const res = await fetch(`${this.baseUrl}/tickets`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      const errorMsg = `PM Tool API returned error [${res.status}]: ${errText || res.statusText}`;
      logger.error('PM Tool createTicket API request failed', {
        module: 'PmClient',
        action: 'createTicket',
        baseUrl: this.baseUrl,
        status: res.status,
        errorCode: ErrorCodes.PM_INTEGRATION,
        error: errorMsg,
      });
      throw new Error(errorMsg);
    }

    const data = await res.json().catch(() => ({}));
    const ticketData = data.data || data.ticket || data.issue || data;

    // Extract dynamic ticket key (e.g. OPS-8) and id (e.g. 120)
    const id = String(ticketData.id || ticketData.key || `TICK-${Date.now()}`);
    const key = ticketData.key || ticketData.ticket_key || ticketData.issue_key || id;
    const spaceKey = ticketData.space?.key || ticketData.space_key || params.spaceKey || params.spaceName || 'space';

    let ticketUrl =
      ticketData.url ||
      ticketData.ticket_url ||
      ticketData.ticketUrl ||
      ticketData.link ||
      ticketData.html_url ||
      ticketData.web_url ||
      data.url;

    if (!ticketUrl) {
      const rootUrl = this.baseUrl.replace(/\/api(\/v\d+)?\/?$/, '');
      ticketUrl = `${rootUrl}/spaces/${spaceKey}/board?ticketId=${id}`;
    }

    const status = ticketData.status?.name || ticketData.status || ticketData.state || data.status?.name || data.status || 'To Do';

    return {
      id,
      key,
      url: ticketUrl,
      status: typeof status === 'string' ? status : 'To Do',
      rawResponse: data,
    };
  }

  async getTicketStatus(externalTicketId: string): Promise<{ status: string; title?: string; url?: string }> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('PM tool is not properly configured');
    }

    const res = await fetch(`${this.baseUrl}/tickets/${encodeURIComponent(externalTicketId)}`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`PM Tool status fetch failed [${res.status}]: ${errText || res.statusText}`);
    }

    const data = await res.json().catch(() => ({}));
    const ticketData = data.data || data.ticket || data.issue || data;

    const status = ticketData.status?.name || ticketData.status || ticketData.state?.name || ticketData.state || 'Unknown';
    const title = ticketData.title || ticketData.summary || ticketData.name;
    const ticketUrl = ticketData.url || ticketData.ticket_url || ticketData.ticketUrl || `${this.baseUrl}/tickets/${externalTicketId}`;

    return {
      status: typeof status === 'string' ? status : 'Unknown',
      title,
      url: ticketUrl,
    };
  }

  async updateTicketStatus(externalTicketKey: string, status: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tickets/${encodeURIComponent(externalTicketKey)}`, {
      method: 'PATCH',
      headers: this.getHeaders(),
      body: JSON.stringify({ status }),
      signal: AbortSignal.timeout(10000),
    });
    return res.json().catch(() => ({}));
  }

  async addComment(externalTicketKey: string, body: string): Promise<any> {
    const res = await fetch(`${this.baseUrl}/tickets/${encodeURIComponent(externalTicketKey)}/comments`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ body }),
      signal: AbortSignal.timeout(10000),
    });
    return res.json().catch(() => ({}));
  }

  async getActiveReleases(spaceKey?: string): Promise<PmReleaseItem[]> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('PM tool is not properly configured');
    }

    // Attempt 1: GET /releases?status=unreleased
    let endpoint = `${this.baseUrl}/releases`;
    let res = await fetch(`${endpoint}?status=unreleased`, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    // Fallback if spaceKey is provided and /releases is 404
    if (!res || !res.ok) {
      if (spaceKey) {
        endpoint = `${this.baseUrl}/spaces/${encodeURIComponent(spaceKey)}/releases`;
        res = await fetch(endpoint, {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);
      }
    }

    if (!res || !res.ok) {
      return [];
    }

    const data = await res.json().catch(() => ({}));
    const rawList = Array.isArray(data) ? data : Array.isArray(data.data) ? data.data : Array.isArray(data.releases) ? data.releases : [];

    return rawList.map((r: any) => ({
      id: String(r.id || r.key || ''),
      name: r.name || r.title || 'Untitled Release',
      versionTag: r.version_tag || r.version || r.tag || undefined,
      releaseDate: r.release_date || r.due_date || r.target_date || undefined,
      status: r.status || 'unreleased',
      ticketCount: Array.isArray(r.tickets) ? r.tickets.length : typeof r.ticket_count === 'number' ? r.ticket_count : typeof r.progress?.total === 'number' ? r.progress.total : undefined,
    }));
  }

  async getReleaseWithTickets(externalReleaseId: string, spaceKey?: string): Promise<PmReleaseDetail | null> {
    if (!this.baseUrl || !this.apiKey) {
      throw new Error('PM tool is not properly configured');
    }

    let endpoint = `${this.baseUrl}/releases/${encodeURIComponent(externalReleaseId)}`;
    let res = await fetch(endpoint, {
      method: 'GET',
      headers: this.getHeaders(),
      signal: AbortSignal.timeout(10000),
    }).catch(() => null);

    if (!res || !res.ok) {
      if (spaceKey) {
        endpoint = `${this.baseUrl}/spaces/${encodeURIComponent(spaceKey)}/releases/${encodeURIComponent(externalReleaseId)}`;
        res = await fetch(endpoint, {
          method: 'GET',
          headers: this.getHeaders(),
          signal: AbortSignal.timeout(10000),
        }).catch(() => null);
      }
    }

    if (!res || !res.ok) {
      return null;
    }

    const data = await res.json().catch(() => ({}));
    const rawRelease = data.data || data.release || data;

    let rawTickets: any[] = [];
    if (Array.isArray(rawRelease.tickets)) {
      rawTickets = rawRelease.tickets;
    } else if (Array.isArray(rawRelease.release_tickets)) {
      rawTickets = rawRelease.release_tickets.map((rt: any) => rt.ticket || rt);
    } else {
      // Fallback: query /releases/:id/tickets
      const ticketRes = await fetch(`${this.baseUrl}/releases/${encodeURIComponent(externalReleaseId)}/tickets`, {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(10000),
      }).catch(() => null);

      if (ticketRes && ticketRes.ok) {
        const ticketData = await ticketRes.json().catch(() => ({}));
        rawTickets = Array.isArray(ticketData) ? ticketData : Array.isArray(ticketData.data) ? ticketData.data : [];
      }
    }

    const rootUrl = this.baseUrl.replace(/\/api(\/v\d+)?\/?$/, '');

    const normalizedTickets = rawTickets.map((t: any) => {
      const id = String(t.id || t.key || '');
      const key = t.key || t.ticket_key || id;
      const title = t.title || t.summary || t.name || `${key} Story`;
      const status = typeof t.status === 'object' ? t.status?.name || 'In QA' : t.status || 'In QA';
      const url = t.url || t.ticket_url || `${rootUrl}/tickets/${key}`;

      return {
        id,
        key,
        title,
        status,
        url,
      };
    });

    return {
      id: String(rawRelease.id || externalReleaseId),
      name: rawRelease.name || rawRelease.title || 'InkaBoard Release',
      versionTag: rawRelease.version_tag || rawRelease.version || rawRelease.tag || undefined,
      releaseDate: rawRelease.release_date || rawRelease.due_date || undefined,
      status: rawRelease.status || 'unreleased',
      description: rawRelease.description || undefined,
      tickets: normalizedTickets,
    };
  }

  async getTickets(query?: string): Promise<Array<{ id: string; key: string; title: string; status: string; spaceName?: string; url?: string }>> {
    if (!this.baseUrl || !this.apiKey) {
      return [];
    }

    try {
      const url = new URL(`${this.baseUrl}/tickets`);
      if (query && query.trim()) {
        url.searchParams.set('q', query.trim());
        url.searchParams.set('search', query.trim());
      }

      const res = await fetch(url.toString(), {
        method: 'GET',
        headers: this.getHeaders(),
        signal: AbortSignal.timeout(6000),
      });

      if (!res.ok) {
        return [];
      }

      const data = await res.json().catch(() => null);
      const list = Array.isArray(data)
        ? data
        : Array.isArray(data?.data)
        ? data.data
        : Array.isArray(data?.tickets)
        ? data.tickets
        : [];

      const rootUrl = this.baseUrl.replace(/\/api(\/v\d+)?\/?$/, '');

      return list.map((t: any) => {
        const id = String(t.id || t.key || '');
        const key = String(t.key || t.ticket_key || id).toUpperCase();
        const title = t.title || t.summary || t.name || `${key} User Story`;
        const status = typeof t.status === 'object' ? t.status?.name || 'In QA' : t.status || 'In QA';
        const spaceName = t.spaces?.name || t.space?.name || t.space_name || undefined;
        const ticketUrl = t.url || t.ticket_url || `${rootUrl}/tickets/${key}`;

        return {
          id,
          key,
          title,
          status,
          spaceName,
          url: ticketUrl,
        };
      });
    } catch (err: any) {
      logger.warn('Failed to fetch tickets from PM tool', {
        module: 'PmClient',
        action: 'getTickets',
        baseUrl: this.baseUrl,
        reason: err.message,
      });
      return [];
    }
  }
}

export interface EffectivePmIntegration {
  enabled: boolean;
  isInherited: boolean;
  hasOverride: boolean;
  config: PmIntegrationConfig;
  workspaceId: string;
  workspaceName: string;
  workspaceSlug: string;
  projectId?: string;
  defaultSpace?: {
    id: string | null;
    key: string | null;
    name: string | null;
  };
}

export async function getEffectivePmIntegration(actualProjectId: string): Promise<EffectivePmIntegration | null> {
  const project = await prisma.project.findUnique({
    where: { id: actualProjectId },
    include: {
      workspace: { select: { id: true, name: true, slug: true } },
      integrations: { where: { provider: 'custom_pm' } },
    },
  });

  if (!project) return null;

  const projectOverride = project.integrations[0];
  if (projectOverride && projectOverride.enabled) {
    const rawConfig = projectOverride.config as any as PmIntegrationConfig;
    return {
      enabled: projectOverride.enabled,
      isInherited: false,
      hasOverride: true,
      config: {
        ...rawConfig,
        apiKey: decrypt(rawConfig.apiKey || ''),
        webhookSecret: decrypt(rawConfig.webhookSecret || ''),
      },
      workspaceId: project.workspace.id,
      workspaceName: project.workspace.name,
      workspaceSlug: project.workspace.slug,
      projectId: project.id,
      defaultSpace: {
        id: project.default_pm_space_id,
        key: project.default_pm_space_key,
        name: project.default_pm_space_name,
      },
    };
  }

  const wsIntegration = await prisma.integration.findFirst({
    where: {
      workspace_id: project.workspace_id,
      provider: 'custom_pm',
    },
  });

  if (wsIntegration) {
    const rawConfig = wsIntegration.config as any as PmIntegrationConfig;
    return {
      enabled: wsIntegration.enabled,
      isInherited: true,
      hasOverride: Boolean(projectOverride),
      config: {
        ...rawConfig,
        apiKey: decrypt(rawConfig.apiKey || ''),
        webhookSecret: decrypt(rawConfig.webhookSecret || ''),
      },
      workspaceId: project.workspace.id,
      workspaceName: project.workspace.name,
      workspaceSlug: project.workspace.slug,
      projectId: project.id,
      defaultSpace: {
        id: project.default_pm_space_id,
        key: project.default_pm_space_key,
        name: project.default_pm_space_name,
      },
    };
  }

  return {
    enabled: false,
    isInherited: true,
    hasOverride: Boolean(projectOverride),
    config: {
      baseUrl: '',
      apiKey: '',
      webhookSecret: '',
      autoCreateDefect: true,
    } as PmIntegrationConfig,
    workspaceId: project.workspace.id,
    workspaceName: project.workspace.name,
    workspaceSlug: project.workspace.slug,
    projectId: project.id,
    defaultSpace: {
      id: project.default_pm_space_id,
      key: project.default_pm_space_key,
      name: project.default_pm_space_name,
    },
  };
}
