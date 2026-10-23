import { describe, it, expect } from 'vitest';

/**
 * Unit tests for Release aggregation, status computation, and approval rules
 */

describe('Release Effective Status Calculation', () => {
  function getEffectiveStatus(rel: {
    decision: 'APPROVED' | 'REJECTED' | null;
    runs: { id: string }[];
  }): 'APPROVED' | 'REJECTED' | 'IN_TESTING' | 'NOT_STARTED' {
    if (rel.decision === 'APPROVED') return 'APPROVED';
    if (rel.decision === 'REJECTED') return 'REJECTED';
    if (rel.runs.length > 0) return 'IN_TESTING';
    return 'NOT_STARTED';
  }

  it('returns NOT_STARTED when zero runs are linked and no decision is set', () => {
    expect(getEffectiveStatus({ decision: null, runs: [] })).toBe('NOT_STARTED');
  });

  it('returns IN_TESTING when at least one run is linked', () => {
    expect(getEffectiveStatus({ decision: null, runs: [{ id: 'RUN-1' }] })).toBe('IN_TESTING');
  });

  it('returns APPROVED when human decision is APPROVED regardless of runs count', () => {
    expect(getEffectiveStatus({ decision: 'APPROVED', runs: [{ id: 'RUN-1' }] })).toBe('APPROVED');
    expect(getEffectiveStatus({ decision: 'APPROVED', runs: [] })).toBe('APPROVED');
  });

  it('returns REJECTED when human decision is REJECTED', () => {
    expect(getEffectiveStatus({ decision: 'REJECTED', runs: [{ id: 'RUN-1' }] })).toBe('REJECTED');
  });
});

describe('Multi-Run Case Deduplication and Metric Aggregation', () => {
  interface RunResultItem {
    testCaseId: string;
    status: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIP' | 'INVALID' | 'PENDING';
    ticketKey?: string | null;
  }

  interface RunItem {
    id: string;
    createdAt: number;
    results: RunResultItem[];
  }

  function aggregateLatestResults(runs: RunItem[]) {
    // Runs are ordered newest-first: latest case verdict takes precedence
    const sortedRuns = [...runs].sort((a, b) => b.createdAt - a.createdAt);
    const seenCases = new Map<string, string>();
    const ticketCoverage = new Map<string, Set<string>>();

    for (const r of sortedRuns) {
      for (const res of r.results) {
        if (!seenCases.has(res.testCaseId)) {
          seenCases.set(res.testCaseId, res.status);
        }
        if (res.ticketKey) {
          if (!ticketCoverage.has(res.ticketKey)) {
            ticketCoverage.set(res.ticketKey, new Set());
          }
          ticketCoverage.get(res.ticketKey)!.add(res.testCaseId);
        }
      }
    }

    let pass = 0, fail = 0, blocked = 0, skip = 0, invalid = 0, pend = 0;
    for (const st of seenCases.values()) {
      if (st === 'PASS') pass++;
      else if (st === 'FAIL') fail++;
      else if (st === 'BLOCKED') blocked++;
      else if (st === 'SKIP') skip++;
      else if (st === 'INVALID') invalid++;
      else pend++;
    }

    const completed = pass + fail + blocked + skip + invalid;
    const total = completed + pend;
    const completedPct = total > 0 ? Math.round((completed / total) * 100) : 0;

    return {
      pass,
      fail,
      blocked,
      skip,
      invalid,
      pend,
      completed,
      completedPct,
      total,
      ticketCoverage,
    };
  }

  it('deduplicates test cases and overwrites older run verdicts with newer ones', () => {
    const olderRun: RunItem = {
      id: 'RUN-1',
      createdAt: 1000,
      results: [
        { testCaseId: 'TC-1', status: 'FAIL', ticketKey: 'BRD-101' },
        { testCaseId: 'TC-2', status: 'PASS', ticketKey: 'BRD-101' },
      ],
    };

    const newerRun: RunItem = {
      id: 'RUN-2',
      createdAt: 2000,
      results: [
        // Re-run of TC-1 passed in newer run
        { testCaseId: 'TC-1', status: 'PASS', ticketKey: 'BRD-101' },
        { testCaseId: 'TC-3', status: 'PENDING', ticketKey: 'BRD-102' },
      ],
    };

    const agg = aggregateLatestResults([olderRun, newerRun]);

    // TC-1 passed in RUN-2, TC-2 passed in RUN-1, TC-3 pending in RUN-2
    expect(agg.total).toBe(3);
    expect(agg.pass).toBe(2);
    expect(agg.fail).toBe(0); // Older fail was overwritten by newer pass!
    expect(agg.pend).toBe(1);

    expect(agg.ticketCoverage.get('BRD-101')?.size).toBe(2);
    expect(agg.ticketCoverage.get('BRD-102')?.size).toBe(1);
  });

  it('correctly reports 100% completion when all tests are resolved including invalid and skip', () => {
    const completedRun: RunItem = {
      id: 'RUN-10',
      createdAt: 5000,
      results: [
        { testCaseId: 'TC-1', status: 'PASS', ticketKey: 'TECH-56' },
        { testCaseId: 'TC-2', status: 'PASS', ticketKey: 'TECH-56' },
        { testCaseId: 'TC-3', status: 'INVALID', ticketKey: 'TECH-56' },
        { testCaseId: 'TC-4', status: 'SKIP', ticketKey: 'TECH-56' },
      ],
    };

    const agg = aggregateLatestResults([completedRun]);
    expect(agg.total).toBe(4);
    expect(agg.pass).toBe(2);
    expect(agg.invalid).toBe(1);
    expect(agg.skip).toBe(1);
    expect(agg.pend).toBe(0);
    expect(agg.completed).toBe(4);
    expect(agg.completedPct).toBe(100); // 100% completed since 0 are pending!
  });
});

describe('Release Timeline and Due Date Calculation', () => {
  function computeTimeline(
    dueDateStr: string | null,
    completedAtStr: string | null,
    createdAtStr: string,
    isCompleted: boolean,
    now: Date = new Date('2026-10-10')
  ): { timelineText: string; isOverdue: boolean } {
    if (isCompleted && completedAtStr) {
      const d = new Date(completedAtStr);
      const completedFormatted = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      const createdFormatted = new Date(createdAtStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
      return {
        timelineText: `Completed ${completedFormatted} · Created ${createdFormatted}`,
        isOverdue: false,
      };
    }

    if (!dueDateStr) {
      return { timelineText: 'No due date', isOverdue: false };
    }

    const due = new Date(dueDateStr);
    const diffMs = due.getTime() - now.getTime();
    const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
    const dueFormatted = due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

    if (diffDays < 0) {
      return {
        timelineText: `Due ${dueFormatted} · Overdue`,
        isOverdue: true,
      };
    } else if (diffDays === 0) {
      return {
        timelineText: 'Due today',
        isOverdue: false,
      };
    } else {
      return {
        timelineText: `Due ${dueFormatted} · ${diffDays} days left`,
        isOverdue: false,
      };
    }
  }

  it('displays "No due date" when due date is null', () => {
    const res = computeTimeline(null, null, '2026-10-01', false);
    expect(res.timelineText).toBe('No due date');
    expect(res.isOverdue).toBe(false);
  });

  it('displays "Due today" when due date is today', () => {
    const res = computeTimeline('2026-10-10', null, '2026-10-01', false, new Date('2026-10-10'));
    expect(res.timelineText).toBe('Due today');
    expect(res.isOverdue).toBe(false);
  });

  it('detects future due date with correct days left', () => {
    const res = computeTimeline('2026-10-15', null, '2026-10-01', false);
    expect(res.timelineText).toContain('Due Oct 15 · 5 days left');
    expect(res.isOverdue).toBe(false);
  });

  it('detects overdue date and flags isOverdue as true', () => {
    const res = computeTimeline('2026-10-07', null, '2026-10-01', false);
    expect(res.timelineText).toBe('Due Oct 7 · Overdue');
    expect(res.isOverdue).toBe(true);
  });

  it('shows Completed date when release is completed', () => {
    const res = computeTimeline('2026-10-15', '2026-10-08', '2026-10-01', true);
    expect(res.timelineText).toContain('Completed Oct 8');
    expect(res.isOverdue).toBe(false);
  });
});

describe('Ticket Status Formatting and Uncovered Exclusion', () => {
  function formatTicketStatusName(status?: string | null): string {
    if (!status) return 'In QA';
    const s = status.trim().toLowerCase();
    if (s === 'to_do' || s === 'todo') return 'To Do';
    if (s === 'in_progress' || s === 'inprogress') return 'In Progress';
    if (s === 'in_dev' || s === 'indev') return 'In Dev';
    if (s === 'qa_ready' || s === 'qaready') return 'QA Ready';
    if (s === 'in_qa' || s === 'inqa') return 'In QA';
    if (s === 'done' || s === 'verified') return 'Done';
    return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  }

  function sanitizeTicketTitle(title?: string | null): string {
    if (!title) return 'Ticket Story';
    return title.replace(/\{\{\s*date\s*\}\}/gi, 'Oct 10').trim();
  }

  it('formats raw database status values into human labels', () => {
    expect(formatTicketStatusName('to_do')).toBe('To Do');
    expect(formatTicketStatusName('in_progress')).toBe('In Progress');
    expect(formatTicketStatusName('qa_ready')).toBe('QA Ready');
    expect(formatTicketStatusName('done')).toBe('Done');
  });

  it('sanitizes template variable placeholders in ticket titles', () => {
    expect(sanitizeTicketTitle('Post-Merge Automated Standup {{date}}')).toBe(
      'Post-Merge Automated Standup Oct 10'
    );
  });

  it('excludes To Do tickets from uncovered blocker count', () => {
    const tickets = [
      { id: 'T-1', status: 'to_do', cases: [], exempt: false },
      { id: 'T-2', status: 'in_qa', cases: [], exempt: false }, // uncovered!
      { id: 'T-3', status: 'in_qa', cases: ['TC-1'], exempt: false }, // covered!
      { id: 'T-4', status: 'in_qa', cases: [], exempt: true }, // exempt!
    ];

    const readyTickets = tickets.filter(
      (t) => !t.exempt && !['to_do', 'todo'].includes(t.status.toLowerCase())
    );
    const uncoveredCount = readyTickets.filter((t) => t.cases.length === 0).length;

    // Only T-2 is uncovered! T-1 is To Do (not ready), T-4 is exempt
    expect(uncoveredCount).toBe(1);
    expect(readyTickets.length).toBe(2);
  });
});

describe('Release Approval Policy Validation', () => {
  function validateApproval(metrics: { pass: number; fail: number; pend: number } | null, note?: string) {
    if (!metrics) {
      throw new Error('Approval blocked: No test runs are linked to this release');
    }
    if (metrics.fail > 0) {
      throw new Error(`Approval is strictly blocked: ${metrics.fail} failing test(s) detected`);
    }
    if (metrics.pend > 0 && (!note || note.trim().length < 5)) {
      throw new Error('Approval requires an override reason note (at least 5 characters)');
    }
    return true;
  }

  it('blocks approval if no runs are linked', () => {
    expect(() => validateApproval(null)).toThrow('Approval blocked: No test runs are linked');
  });

  it('strictly blocks approval if any tests are failing', () => {
    expect(() => validateApproval({ pass: 10, fail: 1, pend: 0 }, 'Reason text')).toThrow(
      'strictly blocked: 1 failing test(s) detected'
    );
  });

  it('requires override reason note of at least 5 chars if tests are pending', () => {
    expect(() => validateApproval({ pass: 10, fail: 0, pend: 2 }, '')).toThrow(
      'requires an override reason note'
    );
    expect(() => validateApproval({ pass: 10, fail: 0, pend: 2 }, 'abc')).toThrow(
      'requires an override reason note'
    );
  });

  it('allows approval with valid override reason when tests are pending', () => {
    expect(validateApproval({ pass: 10, fail: 0, pend: 2 }, 'Verified non-blocking UI polish')).toBe(true);
  });

  it('allows clean approval without note when all tests pass', () => {
    expect(validateApproval({ pass: 10, fail: 0, pend: 0 })).toBe(true);
  });
});

describe('InkaBoard Remote Release Payload Normalization', () => {
  it('normalizes InkaBoard release list with version and ticket counts', () => {
    const rawInkaBoardResponse = [
      {
        id: 'rel-1042',
        name: 'Release 2026.10 - Core Checkout',
        version_tag: 'v2.4.0',
        release_date: '2026-10-15',
        status: 'unreleased',
        progress: { total: 6, done: 4 },
      },
      {
        id: 'rel-1049',
        name: 'Release 2026.11 - Multi-currency Engine',
        version: 'v2.5.0',
        status: 'unreleased',
        tickets: [{ key: 'BRD-120' }, { key: 'BRD-121' }],
      },
    ];

    const normalized = rawInkaBoardResponse.map((r: any) => ({
      id: String(r.id),
      name: r.name,
      versionTag: r.version_tag || r.version,
      releaseDate: r.release_date || r.due_date,
      status: r.status,
      ticketCount: Array.isArray(r.tickets) ? r.tickets.length : r.progress?.total,
    }));

    expect(normalized).toHaveLength(2);
    expect(normalized[0].versionTag).toBe('v2.4.0');
    expect(normalized[0].ticketCount).toBe(6);
    expect(normalized[1].ticketCount).toBe(2);
  });

  it('normalizes embedded tickets from InkaBoard release detail', () => {
    const rawReleaseDetail = {
      id: 'rel-1042',
      name: 'Core Checkout',
      version_tag: 'v2.4.0',
      release_date: '2026-10-15',
      tickets: [
        { key: 'BRD-101', title: 'Apple Pay Checkout Flow', status: 'In QA' },
        { key: 'BRD-102', title: 'Tax Jar Nexus Boundaries', status: { name: 'Done' } },
      ],
    };

    const tickets = rawReleaseDetail.tickets.map((t: any) => ({
      key: t.key.toUpperCase(),
      title: t.title,
      status: typeof t.status === 'object' ? t.status.name : t.status,
    }));

    expect(tickets).toHaveLength(2);
    expect(tickets[0].key).toBe('BRD-101');
    expect(tickets[1].status).toBe('Done');

    const formattedName = `${rawReleaseDetail.name}${rawReleaseDetail.version_tag ? ` - ${rawReleaseDetail.version_tag}` : ''}`;
    expect(formattedName).toBe('Core Checkout - v2.4.0');
  });
});

describe('Finalized Release Immutability & Locking Policy', () => {
  interface ReleaseRecord {
    id: string;
    decision: 'APPROVED' | 'REJECTED' | null;
  }

  function assertReleaseNotLocked(rel: ReleaseRecord, action: string) {
    if (rel.decision !== null) {
      throw new Error(`Cannot ${action} on an approved or rejected release. Please re-open the release first.`);
    }
    return true;
  }

  it('allows modifications when release is in testing or not started', () => {
    const activeRel: ReleaseRecord = { id: 'REL-1', decision: null };
    expect(assertReleaseNotLocked(activeRel, 'add tickets')).toBe(true);
    expect(assertReleaseNotLocked(activeRel, 'link test runs')).toBe(true);
  });

  it('rejects adding tickets to an approved release', () => {
    const approvedRel: ReleaseRecord = { id: 'REL-1', decision: 'APPROVED' };
    expect(() => assertReleaseNotLocked(approvedRel, 'add tickets')).toThrow('Please re-open the release first');
  });

  it('rejects linking runs to a rejected release', () => {
    const rejectedRel: ReleaseRecord = { id: 'REL-1', decision: 'REJECTED' };
    expect(() => assertReleaseNotLocked(rejectedRel, 'link test runs')).toThrow('Please re-open the release first');
  });
});

