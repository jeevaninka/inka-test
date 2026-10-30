'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { DataTable } from '@/components/common/DataTable';
import { EmptyState } from '@/components/common/EmptyState';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Building2,
  Plus,
  Globe,
  FolderKanban,
  Users,
  Link2,
  Check,
  RotateCw,
  ArrowLeft,
  ExternalLink,
  CheckCircle2,
  Clock,
  ShieldOff,
  ShieldCheck,
  Trash2,
  AlertTriangle,
} from 'lucide-react';
import { toast } from 'sonner';
import Image from 'next/image';
import {
  createOrganizationByPlatformAdminAction,
  resendOrganizationInvitationAction,
  type ProvisionOrgFieldErrors,
} from '@/app/actions/organization-invitations';
import {
  deleteOrganizationAction,
  suspendOrganizationAction,
  unsuspendOrganizationAction,
} from '@/app/actions/organization-access';
import { Textarea } from '@/components/ui/textarea';

interface PlatformOrgItem {
  id: string;
  name: string;
  slug: string;
  allowedDomains: string[];
  domainJoinEnabled: boolean;
  createdAt: string;
  workspaces: { id: string; name: string; slug: string }[];
  memberCount: number;
  suspendedAt: string | null;
  suspendReason: string | null;
  suspendedMemberCount: number;
  owner: {
    email: string;
    name: string | null;
    status: 'ACTIVE' | 'INVITED' | 'EXPIRED';
    inviteToken: string | null;
    invitationId?: string;
  } | null;
}

export function PlatformOrganizationsClient({
  initialOrganizations,
}: {
  initialOrganizations: PlatformOrgItem[];
}) {
  const router = useRouter();
  const [organizations, setOrganizations] = useState<PlatformOrgItem[]>(initialOrganizations);
  const [showProvisionModal, setShowProvisionModal] = useState(false);

  // Provision form state
  const [orgName, setOrgName] = useState('');
  const [orgSlug, setOrgSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [domain, setDomain] = useState('');
  const [workspaceName, setWorkspaceName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ProvisionOrgFieldErrors>({});
  const [isPending, startTransition] = useTransition();

  // Copy & regenerate state
  const [copiedOrgId, setCopiedOrgId] = useState<string | null>(null);
  const [resendingOrgId, setResendingOrgId] = useState<string | null>(null);

  // Suspension & deletion state
  const [statusOrg, setStatusOrg] = useState<PlatformOrgItem | null>(null);
  const [suspendReason, setSuspendReason] = useState('');
  const [statusBusy, setStatusBusy] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PlatformOrgItem | null>(null);
  const [deleteConfirm, setDeleteConfirm] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const handleToggleSuspension = async () => {
    if (!statusOrg) return;
    setStatusBusy(true);
    try {
      if (statusOrg.suspendedAt) {
        await unsuspendOrganizationAction({ organizationId: statusOrg.id });
        setOrganizations((prev) =>
          prev.map((o) =>
            o.id === statusOrg.id ? { ...o, suspendedAt: null, suspendReason: null } : o
          )
        );
        toast.success(`${statusOrg.name} restored — members can sign in again`);
      } else {
        const reason = suspendReason.trim() || null;
        await suspendOrganizationAction({ organizationId: statusOrg.id, reason });
        setOrganizations((prev) =>
          prev.map((o) =>
            o.id === statusOrg.id
              ? { ...o, suspendedAt: new Date().toISOString(), suspendReason: reason }
              : o
          )
        );
        toast.success(`${statusOrg.name} suspended — all access revoked immediately`);
      }
      setStatusOrg(null);
      setSuspendReason('');
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Could not update organization access');
    } finally {
      setStatusBusy(false);
    }
  };

  const handleDeleteOrganization = async () => {
    if (!deleteTarget) return;
    setDeleteBusy(true);
    try {
      await deleteOrganizationAction({
        organizationId: deleteTarget.id,
        confirmSlug: deleteConfirm.trim(),
      });
      setOrganizations((prev) => prev.filter((o) => o.id !== deleteTarget.id));
      toast.success(`${deleteTarget.name} deleted`);
      setDeleteTarget(null);
      setDeleteConfirm('');
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || 'Could not delete organization');
    } finally {
      setDeleteBusy(false);
    }
  };

  const slugify = (val: string) =>
    val
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-|-$/g, '');

  const handleOpenProvisionModal = () => {
    setOrgName('');
    setOrgSlug('');
    setSlugTouched(false);
    setDomain('');
    setWorkspaceName('');
    setOwnerEmail('');
    setFieldErrors({});
    setShowProvisionModal(true);
  };

  const handleNameChange = (val: string) => {
    setOrgName(val);
    if (!slugTouched) {
      setOrgSlug(slugify(val));
    }
    if (fieldErrors.name || fieldErrors.slug) {
      setFieldErrors((prev) => ({ ...prev, name: undefined, slug: undefined }));
    }
  };

  const handleCopyInvite = async (orgId: string, token: string) => {
    const url = `${window.location.origin}/invite?token=${token}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedOrgId(orgId);
      toast.success('Owner invite link copied to clipboard');
      setTimeout(() => setCopiedOrgId((prev) => (prev === orgId ? null : prev)), 2000);
    } catch {
      toast.error('Failed to copy invite link');
    }
  };

  const handleRegenerateOwnerInvite = async (orgId: string, invitationId: string) => {
    setResendingOrgId(orgId);
    try {
      const res = await resendOrganizationInvitationAction(invitationId);
      setOrganizations((prev) =>
        prev.map((o) =>
          o.id === orgId && o.owner
            ? {
                ...o,
                owner: {
                  ...o.owner,
                  status: 'INVITED',
                  inviteToken: res.token,
                },
              }
            : o
        )
      );
      toast.success('New owner invite token generated');
    } catch (err: any) {
      toast.error(err.message || 'Failed to regenerate owner invite');
    } finally {
      setResendingOrgId(null);
    }
  };

  const handleProvision = () => {
    setFieldErrors({});
    startTransition(async () => {
      try {
        const res = await createOrganizationByPlatformAdminAction({
          name: orgName,
          slug: orgSlug || slugify(orgName),
          domain: domain || undefined,
          workspaceName,
          ownerEmail,
        });

        if (!res.ok) {
          setFieldErrors(res.fieldErrors || {});
          return;
        }

        toast.success(`Organization "${res.organization?.name}" provisioned`);
        setShowProvisionModal(false);
        router.refresh();
        window.location.reload();
      } catch (err: any) {
        toast.error(err.message || 'Failed to provision organization');
      }
    });
  };

  const totalWorkspaces = organizations.reduce((acc, o) => acc + o.workspaces.length, 0);
  const totalMembers = organizations.reduce((acc, o) => acc + o.memberCount, 0);

  const columns = [
    {
      id: 'organization',
      header: 'Organization',
      className: 'w-[26%]',
      accessor: (row: PlatformOrgItem) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Building2 className="h-4 w-4 text-primary shrink-0" />
            <span className="font-semibold text-sm text-zinc-100">{row.name}</span>
          </div>
          <Link
            href={`/org/${row.slug}/members`}
            className="inline-flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-primary transition-colors"
          >
            <span>/org/{row.slug}</span>
            <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      className: 'w-[10%]',
      accessor: (row: PlatformOrgItem) =>
        row.suspendedAt ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-red-500/10 border border-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-400 whitespace-nowrap">
            <ShieldOff className="h-3 w-3" /> Suspended
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 border border-emerald-500/20 px-2 py-0.5 text-[11px] font-semibold text-emerald-400 whitespace-nowrap">
            <ShieldCheck className="h-3 w-3" /> Active
          </span>
        ),
    },
    {
      id: 'domains',
      header: 'Domains',
      className: 'w-[18%]',
      accessor: (row: PlatformOrgItem) =>
        row.allowedDomains.length === 0 ? (
          <span className="text-xs text-zinc-500 italic">Manual invites only</span>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {row.allowedDomains.map((d) => (
              <span
                key={d}
                className="text-xs font-mono px-2.5 py-1 rounded-lg bg-primary/10 border border-primary/20 text-primary whitespace-nowrap"
              >
                @{d}
              </span>
            ))}
          </div>
        ),
    },
    {
      id: 'workspaces',
      header: 'Workspaces',
      className: 'w-[22%]',
      accessor: (row: PlatformOrgItem) => (
        <div className="flex flex-col gap-1">
          {row.workspaces.map((ws) => (
            <Link
              key={ws.id}
              href={`/workspace/${ws.slug}`}
              className="text-xs font-mono text-zinc-300 hover:text-primary transition-colors whitespace-nowrap"
            >
              /workspace/{ws.slug}
            </Link>
          ))}
        </div>
      ),
    },
    {
      id: 'members',
      header: 'Members',
      className: 'w-[12%] whitespace-nowrap',
      accessor: (row: PlatformOrgItem) => (
        <span className="text-xs font-mono text-zinc-300 whitespace-nowrap">
          {row.memberCount} active
        </span>
      ),
    },
    {
      id: 'owner',
      header: 'Owner',
      className: 'w-[22%]',
      accessor: (row: PlatformOrgItem) => {
        if (!row.owner) {
          return <span className="text-xs text-zinc-500">—</span>;
        }
        return (
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="text-xs font-mono text-zinc-200">{row.owner.email}</p>
              {row.owner.status === 'ACTIVE' ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-emerald-400">
                  <CheckCircle2 className="h-3 w-3" /> Active Owner
                </span>
              ) : row.owner.status === 'INVITED' ? (
                <span className="inline-flex items-center gap-1 text-[11px] text-amber-400">
                  <Clock className="h-3 w-3" /> Owner Invited
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 text-[11px] text-red-400">
                  <Clock className="h-3 w-3" /> Invite Expired
                </span>
              )}
            </div>

            {row.owner.status === 'INVITED' && row.owner.inviteToken && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs border-white/10 text-zinc-300 hover:text-white rounded-lg shrink-0"
                onClick={() => handleCopyInvite(row.id, row.owner!.inviteToken!)}
              >
                {copiedOrgId === row.id ? (
                  <>
                    <Check className="h-3 w-3 mr-1 text-emerald-400" />
                    Copied
                  </>
                ) : (
                  <>
                    <Link2 className="h-3 w-3 mr-1" />
                    Copy Link
                  </>
                )}
              </Button>
            )}

            {row.owner.status === 'EXPIRED' && row.owner.invitationId && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 px-2.5 text-xs border-primary/30 text-primary hover:bg-primary/10 rounded-lg shrink-0"
                onClick={() => handleRegenerateOwnerInvite(row.id, row.owner!.invitationId!)}
                disabled={resendingOrgId === row.id}
              >
                <RotateCw
                  className={cn('h-3 w-3 mr-1', resendingOrgId === row.id && 'animate-spin')}
                />
                Generate New Invite
              </Button>
            )}
          </div>
        );
      },
    },
    {
      id: 'access',
      header: 'Access',
      className: 'w-[14%] whitespace-nowrap',
      accessor: (row: PlatformOrgItem) => (
        <div className="flex items-center gap-1.5">
          <Button
            variant="outline"
            size="sm"
            className={cn(
              'h-7 px-2.5 text-[11px] rounded-lg',
              row.suspendedAt
                ? 'border-emerald-500/30 text-emerald-400 hover:bg-emerald-500/10'
                : 'border-amber-500/30 text-amber-400 hover:bg-amber-500/10'
            )}
            onClick={() => {
              setStatusOrg(row);
              setSuspendReason(row.suspendReason || '');
            }}
          >
            {row.suspendedAt ? 'Restore' : 'Suspend'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0 rounded-lg border-red-500/30 text-red-400 hover:bg-red-500/10"
            title="Delete organization"
            onClick={() => {
              setDeleteTarget(row);
              setDeleteConfirm('');
            }}
          >
            <Trash2 className="h-3 w-3" />
          </Button>
        </div>
      ),
    },
  ];

  const derivedWsSlug = slugify(workspaceName);

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap pb-4 border-b border-border/40">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono uppercase tracking-wider mb-1">
            <Image src="/logo.svg" alt="InkaTest" width={14} height={14} />
            <span>Platform Super Admin</span>
          </div>
          <h1 className="text-2xl md:text-3xl font-bold tracking-tight text-foreground">
            Tenant Organizations
          </h1>
          <p className="text-xs md:text-sm text-muted-foreground">
            Provision isolated customer organizations, configure their corporate domains, and invite their initial owners.
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <Button asChild variant="outline">
            <Link href="/workspace">
              <ArrowLeft className="h-4 w-4 mr-1.5" />
              Back to Workspaces
            </Link>
          </Button>
          <Button onClick={handleOpenProvisionModal} className="gradient-btn text-white">
            <Plus className="h-4 w-4 mr-1.5" />
            New Organization
          </Button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="glass rounded-2xl border border-border/50 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-primary/15 border border-primary/20 flex items-center justify-center text-primary">
            <Building2 className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Organizations</p>
            <p className="text-2xl font-bold text-zinc-100">{organizations.length}</p>
          </div>
        </div>

        <div className="glass rounded-2xl border border-border/50 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-cyan-500/15 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
            <FolderKanban className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Workspaces</p>
            <p className="text-2xl font-bold text-zinc-100">{totalWorkspaces}</p>
          </div>
        </div>

        <div className="glass rounded-2xl border border-border/50 p-5 flex items-center gap-4">
          <div className="w-10 h-10 rounded-xl bg-emerald-500/15 border border-emerald-500/20 flex items-center justify-center text-emerald-400">
            <Users className="h-5 w-5" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Total Active Members</p>
            <p className="text-2xl font-bold text-zinc-100">{totalMembers}</p>
          </div>
        </div>
      </div>

      {/* Organizations Table */}
      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={organizations}
          columns={columns}
          getId={(row) => row.id}
          tableClassName="w-full min-w-[980px]"
          emptyComponent={
            <EmptyState
              icon={Building2}
              heading="No organizations"
              subtext="Provision your first tenant organization."
            />
          }
        />
      </div>

      {/* Provision New Organization Modal */}
      <Dialog open={showProvisionModal} onOpenChange={setShowProvisionModal}>
        <DialogContent className="glass border-0 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle className="gradient-text text-xl">
              Provision New Organization
            </DialogTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Creates an isolated organization, its first workspace, and a 7-day Owner invitation link.
            </p>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {/* Organization Name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Organization Name</Label>
              <Input
                placeholder="e.g. Acme Corp"
                value={orgName}
                onChange={(e) => handleNameChange(e.target.value)}
                className="bg-white/5 border-white/10 text-sm"
                autoFocus
              />
              {fieldErrors.name && (
                <p className="text-xs text-red-400">{fieldErrors.name}</p>
              )}
            </div>

            {/* Organization Slug */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Organization Admin Route Slug</Label>
              <div className="flex items-center rounded-xl border border-white/10 bg-white/5 px-3">
                <span className="text-xs font-mono text-zinc-500 select-none">/org/</span>
                <input
                  type="text"
                  value={orgSlug}
                  onChange={(e) => {
                    setSlugTouched(true);
                    setOrgSlug(slugify(e.target.value));
                    if (fieldErrors.slug) setFieldErrors((p) => ({ ...p, slug: undefined }));
                  }}
                  placeholder="acme-corp"
                  className="h-9 flex-1 bg-transparent text-sm font-mono text-zinc-100 focus:outline-none pl-1"
                />
              </div>
              {fieldErrors.slug && (
                <p className="text-xs text-red-400">{fieldErrors.slug}</p>
              )}
            </div>

            {/* Allowed Corporate Email Domain */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">
                Allowed Corporate Email Domain <span className="text-zinc-500">(optional)</span>
              </Label>
              <Input
                placeholder="e.g. acme.com"
                value={domain}
                onChange={(e) => {
                  setDomain(e.target.value);
                  if (fieldErrors.domain) setFieldErrors((p) => ({ ...p, domain: undefined }));
                }}
                className="bg-white/5 border-white/10 text-sm font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Leave blank to invite members manually only.
              </p>
              {fieldErrors.domain && (
                <p className="text-xs text-red-400">{fieldErrors.domain}</p>
              )}
            </div>

            {/* Initial Workspace Name */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">Initial Workspace Name</Label>
              <Input
                placeholder="e.g. ACME QA"
                value={workspaceName}
                onChange={(e) => {
                  setWorkspaceName(e.target.value);
                  if (fieldErrors.workspaceName) {
                    setFieldErrors((p) => ({ ...p, workspaceName: undefined }));
                  }
                }}
                className="bg-white/5 border-white/10 text-sm"
              />
              {derivedWsSlug && (
                <p className="text-[11px] font-mono text-zinc-500">
                  Route: /workspace/{derivedWsSlug}
                </p>
              )}
              {fieldErrors.workspaceName && (
                <p className="text-xs text-red-400">{fieldErrors.workspaceName}</p>
              )}
            </div>

            {/* First Owner Email */}
            <div className="space-y-1.5">
              <Label className="text-xs text-zinc-300">First Organization Owner Email</Label>
              <Input
                type="email"
                placeholder="cto@acme.com"
                value={ownerEmail}
                onChange={(e) => {
                  setOwnerEmail(e.target.value);
                  if (fieldErrors.ownerEmail) {
                    setFieldErrors((p) => ({ ...p, ownerEmail: undefined }));
                  }
                }}
                className="bg-white/5 border-white/10 text-sm font-mono"
              />
              <p className="text-[11px] text-zinc-500">
                Receives a 7-day Owner invite link with full authority over this organization.
              </p>
              {fieldErrors.ownerEmail && (
                <p className="text-xs text-red-400">{fieldErrors.ownerEmail}</p>
              )}
            </div>
          </div>

          <DialogFooter>
            <Button
              variant="ghost"
              onClick={() => setShowProvisionModal(false)}
              disabled={isPending}
            >
              Cancel
            </Button>
            <Button
              onClick={handleProvision}
              disabled={isPending}
              className="gradient-btn text-white font-semibold"
            >
              {isPending ? 'Provisioning…' : 'Provision Organization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Suspend / Restore Organization */}
      <Dialog
        open={!!statusOrg}
        onOpenChange={(open) => {
          if (!open) {
            setStatusOrg(null);
            setSuspendReason('');
          }
        }}
      >
        <DialogContent className="glass border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {statusOrg?.suspendedAt ? 'Restore organization access' : 'Suspend organization'}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            {statusOrg?.suspendedAt ? (
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 text-xs text-zinc-300 leading-relaxed">
                Restoring re-enables access for every member of{' '}
                <strong className="text-zinc-100">{statusOrg.name}</strong>, including the owner.
                No data was removed while suspended.
              </div>
            ) : (
              <>
                <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-zinc-300 leading-relaxed">
                  Suspending <strong className="text-zinc-100">{statusOrg?.name}</strong> immediately
                  blocks every member — including the organization owner — from its workspaces,
                  projects, API and organization console. Nothing is deleted; access returns on
                  restore.
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="suspend-reason" className="text-xs text-zinc-400">
                    Reason (optional, shown to members)
                  </Label>
                  <Textarea
                    id="suspend-reason"
                    value={suspendReason}
                    onChange={(e) => setSuspendReason(e.target.value)}
                    placeholder="e.g. Unpaid invoice, security review in progress…"
                    className="bg-white/5 border-white/10 text-sm min-h-[80px]"
                  />
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setStatusOrg(null)} disabled={statusBusy}>
              Cancel
            </Button>
            <Button
              onClick={handleToggleSuspension}
              disabled={statusBusy}
              className={cn(
                'font-semibold',
                statusOrg?.suspendedAt
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                  : 'bg-amber-600 hover:bg-amber-500 text-white'
              )}
            >
              {statusBusy
                ? 'Working…'
                : statusOrg?.suspendedAt
                ? 'Restore Access'
                : 'Suspend Organization'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Organization */}
      <Dialog
        open={!!deleteTarget}
        onOpenChange={(open) => {
          if (!open) {
            setDeleteTarget(null);
            setDeleteConfirm('');
          }
        }}
      >
        <DialogContent className="glass border-0 sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-400">
              <AlertTriangle className="h-5 w-5" />
              Delete organization
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-xl border border-red-500/20 bg-red-500/5 p-3 text-xs text-zinc-300 leading-relaxed space-y-2">
              <p>
                This permanently deletes <strong className="text-zinc-100">{deleteTarget?.name}</strong>,
                all of its workspaces, projects, test cases, runs and member access.
              </p>
              <p>
                {deleteTarget?.workspaces.length ?? 0} workspace(s) ·{' '}
                {deleteTarget?.memberCount ?? 0} member(s). This cannot be undone.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm" className="text-xs text-zinc-400">
                Type <span className="font-mono text-zinc-200">{deleteTarget?.slug}</span> to confirm
              </Label>
              <Input
                id="delete-confirm"
                value={deleteConfirm}
                onChange={(e) => setDeleteConfirm(e.target.value)}
                placeholder={deleteTarget?.slug}
                autoComplete="off"
                className="bg-white/5 border-white/10 text-sm font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteTarget(null)} disabled={deleteBusy}>
              Cancel
            </Button>
            <Button
              onClick={handleDeleteOrganization}
              disabled={
                deleteBusy ||
                !deleteTarget ||
                deleteConfirm.trim() !== deleteTarget.slug
              }
              className="bg-red-600 hover:bg-red-500 text-white font-semibold"
            >
              {deleteBusy ? 'Deleting…' : 'Delete Permanently'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
