/**
 * Release and Ticket formatting utilities
 */

export function sanitizeTicketTitle(title?: string | null): string {
  if (!title) return 'Ticket Story';
  const nowStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return title.replace(/\{\{\s*date\s*\}\}/gi, nowStr).trim();
}

export function formatTicketStatusName(status?: string | null): string {
  if (!status) return 'In QA';
  const s = status.trim().toLowerCase();
  if (s === 'to_do' || s === 'todo') return 'To Do';
  if (s === 'in_progress' || s === 'inprogress') return 'In Progress';
  if (s === 'in_dev' || s === 'indev') return 'In Dev';
  if (s === 'qa_ready' || s === 'qaready') return 'QA Ready';
  if (s === 'in_qa' || s === 'inqa') return 'In QA';
  if (s === 'ready_for_uat') return 'Ready for UAT';
  if (s === 'in_uat' || s === 'inuat') return 'In UAT';
  if (s === 'done' || s === 'verified') return 'Done';
  return status.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

export function computeTimeAgo(dateStr?: string | null): string {
  if (!dateStr) return 'recently';
  const diffMs = Date.now() - new Date(dateStr).getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  if (diffMins < 60) return `${Math.max(1, diffMins)}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;
  const diffDays = Math.floor(diffHours / 24);
  return `${diffDays}d ago`;
}
