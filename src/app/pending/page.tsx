'use client';

import { useCallback, useEffect, useState } from 'react';
import { signOut, useSession } from 'next-auth/react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  requestDomainJoinAction,
  acceptInvitationAction,
} from '@/app/actions/workspace';
import {
  checkApprovalStatusAction,
  resendVerificationEmailAction,
  resolveOnboardingAction,
  type OnboardingResolution,
} from '@/app/actions/onboarding';
import {
  Loader2,
  Building2,
  LogOut,
  RefreshCw,
  Clock,
  Send,
  MailQuestion,
  ArrowRight,
  MailCheck,
  Mail,
  Plus,
  ShieldCheck,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { logger } from '@/lib/logger.client';

export default function PendingPage() {
  const router = useRouter();
  const { status, update } = useSession();

  const [loading, setLoading] = useState(true);
  const [resolution, setResolution] = useState<OnboardingResolution | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isJoining, setIsJoining] = useState(false);
  const [isResending, setIsResending] = useState(false);

  const loadResolution = useCallback(async () => {
    const info = await resolveOnboardingAction();
    if (info.destination === 'WORKSPACE') {
      router.replace('/workspace');
      return info;
    }
    if (info.destination === 'SUSPENDED') {
      const orgId = info.suspension?.organizationId;
      router.replace(orgId ? `/suspended?org=${encodeURIComponent(orgId)}` : '/suspended');
      return info;
    }
    setResolution(info);
    return info;
  }, [router]);

  useEffect(() => {
    const load = async () => {
      try {
        if (status === 'unauthenticated') {
          router.replace('/login');
          return;
        }
        if (status === 'authenticated') {
          await loadResolution();
        }
      } catch (err: any) {
        logger.error('Failed to resolve onboarding destination', {
          component: 'PendingPage',
          action: 'resolveOnboarding',
          error: err,
        });
      } finally {
        setLoading(false);
      }
    };

    if (status !== 'loading') {
      load();
    }
  }, [status, router, loadResolution]);

  const handleCheckStatus = async () => {
    setRefreshing(true);
    setStatusMessage(null);
    try {
      const result = await checkApprovalStatusAction();
      setResolution(result.resolution);
      if (result.approved) {
        await update();
        toast.success('Your access has been approved!');
        window.location.assign('/workspace');
        return;
      }
      setStatusMessage('Still awaiting review');
    } catch (err: any) {
      toast.error(err.message || 'Failed to check approval status');
    } finally {
      setRefreshing(false);
    }
  };

  const handleJoin = async () => {
    const invitation = resolution?.pendingInvitation;
    if (!invitation?.token) return;
    setIsJoining(true);
    try {
      if (invitation.kind === 'organization') {
        const { acceptOrganizationInvitationAction } = await import('@/app/actions/organization-invitations');
        const res = await acceptOrganizationInvitationAction(invitation.token);
        await update();
        toast.success(`Welcome to ${res.organizationName || invitation.organizationName}!`);
        window.location.assign(
          res.firstWorkspaceSlug ? `/workspace/${res.firstWorkspaceSlug}` : '/workspace'
        );
      } else {
        const res = await acceptInvitationAction(invitation.token);
        await update();
        toast.success(`Welcome to ${invitation.workspaceName}!`);
        window.location.assign(
          res.workspaceSlug ? `/workspace/${res.workspaceSlug}` : '/workspace'
        );
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept invitation');
      setIsJoining(false);
    }
  };

  const handleRequestAccess = async () => {
    setIsSubmitting(true);
    try {
      await requestDomainJoinAction({ message: message.trim() || undefined });
      toast.success('Access request submitted to your administrator');
      setResolution((prev) =>
        prev
          ? {
              ...prev,
              destination: 'WAITING',
              pendingRequest: {
                id: prev.pendingRequest?.id || 'pending',
                organizationName:
                  prev.matchedOrganization?.name || prev.pendingRequest?.organizationName || 'your organization',
                note: message.trim() || null,
                kind: 'organization',
              },
            }
          : null
      );
      setMessage('');
      setShowNote(false);
      setStatusMessage(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to submit request');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleResendVerification = async () => {
    setIsResending(true);
    try {
      const res = await resendVerificationEmailAction();
      if (res.success) {
        toast.success('Verification email sent. Check your inbox.');
      } else {
        toast.error(res.error || 'Could not send verification email');
      }
    } catch (err: any) {
      toast.error(err.message || 'Could not send verification email');
    } finally {
      setIsResending(false);
    }
  };

  const handleRecheckVerification = async () => {
    setRefreshing(true);
    try {
      const info = await loadResolution();
      if (info.destination === 'VERIFY_EMAIL') {
        toast.error('Email is not verified yet. Please use the link in your inbox.');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to check verification');
    } finally {
      setRefreshing(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] flex flex-col items-center justify-center p-6 relative overflow-hidden text-foreground">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-float animation-delay-300" />

      <div className="relative max-w-[500px] w-full rounded-[2.5rem] border border-white/10 bg-white/5 backdrop-blur-2xl p-10 shadow-2xl animate-scale-in">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        {loading || !resolution ? (
          <div className="flex flex-col items-center justify-center py-16 space-y-4">
            <Loader2 className="h-8 w-8 text-primary animate-spin" />
            <p className="text-xs text-zinc-400">Verifying account access...</p>
          </div>
        ) : resolution.destination === 'VERIFY_EMAIL' ? (
          /* Email verification is required before invites or domain matches are shown */
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center text-cyan-400">
                <Mail className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white">Verify your email</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                We sent a verification link to{' '}
                <strong className="text-zinc-200">{resolution.userEmail}</strong>. Verify it to
                continue.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2 text-xs text-zinc-400">
              <p>
                Invitations and organization matches stay hidden until your email is verified.
                Google sign-in is verified automatically.
              </p>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                onClick={handleResendVerification}
                disabled={isResending}
                className="w-full h-12 rounded-xl text-base font-semibold gradient-btn text-white"
              >
                {isResending ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Sending...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    Resend verification email
                  </span>
                )}
              </Button>

              <Button
                variant="outline"
                onClick={handleRecheckVerification}
                disabled={refreshing}
                className="w-full h-11 rounded-xl border-white/10 text-zinc-300 hover:text-white flex items-center justify-center gap-2"
              >
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                I&apos;ve verified my email
              </Button>
            </div>
          </div>
        ) : resolution.destination === 'INVITE' && resolution.pendingInvitation ? (
          /* Invite wins over any pending request */
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-emerald-500/10 border border-emerald-500/20 flex items-center justify-center text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.2)]">
                <MailCheck className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white">You Have an Invitation!</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                You&apos;ve been invited to{' '}
                <strong className="text-zinc-100">
                  {resolution.pendingInvitation.organizationName}
                </strong>{' '}
                as{' '}
                <strong className="text-primary">{resolution.pendingInvitation.role}</strong>.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Organization</span>
                <span className="text-zinc-200 font-medium">
                  {resolution.pendingInvitation.organizationName}
                </span>
              </div>
              {resolution.pendingInvitation.kind === 'workspace' && (
                <div className="flex items-center justify-between text-xs">
                  <span className="text-zinc-400">Workspace</span>
                  <span className="text-zinc-100 font-semibold">
                    {resolution.pendingInvitation.workspaceName}
                  </span>
                </div>
              )}
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Assigned Role</span>
                <span className="text-primary font-medium px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                  {resolution.pendingInvitation.role}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Invited Email</span>
                <span className="text-zinc-300">{resolution.userEmail}</span>
              </div>
            </div>

            <div className="space-y-3 pt-2">
              <Button
                onClick={handleJoin}
                disabled={isJoining}
                className="w-full h-12 rounded-xl text-base font-semibold gradient-btn text-white"
              >
                {isJoining ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Joining Workspace...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    Join
                    <ArrowRight className="h-4 w-4" />
                  </span>
                )}
              </Button>
            </div>
          </div>
        ) : resolution.destination === 'WAITING' ? (
          /* Waiting for manual approval check – no polling */
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.2)]">
                <Clock className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white">Request Sent</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                Your request has been submitted to{' '}
                <strong className="text-zinc-200">
                  {resolution.pendingRequest?.organizationName || resolution.matchedOrganization?.name}
                </strong>{' '}
                administrators. You will be granted access as soon as it is approved.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Organization</span>
                <span className="text-zinc-200 font-medium">
                  {resolution.pendingRequest?.organizationName || resolution.matchedOrganization?.name}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Account</span>
                <span className="text-zinc-200">{resolution.userEmail}</span>
              </div>
              <div className="flex items-center justify-between text-xs pt-1 border-t border-white/5">
                <span className="text-zinc-400">Status</span>
                <span className="inline-flex items-center gap-1.5 text-xs text-amber-400 font-medium">
                  <span className="h-2 w-2 rounded-full bg-amber-400" />
                  Awaiting Review
                </span>
              </div>
            </div>

            {resolution.pendingRequest?.note && (
              <div className="p-3.5 rounded-xl bg-white/5 border border-white/5 text-xs">
                <p className="text-zinc-500 mb-1 font-medium">Your Note to Admin</p>
                <p className="text-zinc-300 italic">&ldquo;{resolution.pendingRequest.note}&rdquo;</p>
              </div>
            )}

            <div className="space-y-3 pt-2">
              <Button
                variant="outline"
                onClick={handleCheckStatus}
                disabled={refreshing}
                className="w-full h-11 rounded-xl border-white/10 text-zinc-300 hover:text-white flex items-center justify-center gap-2"
              >
                <RefreshCw className={cn('h-4 w-4', refreshing && 'animate-spin')} />
                {refreshing ? 'Checking Status...' : 'Check Approval Status'}
              </Button>

              {statusMessage && (
                <p className="text-center text-xs text-zinc-400">{statusMessage}</p>
              )}

              <button
                type="button"
                className="w-full text-zinc-500 hover:text-zinc-300 h-9 text-xs"
                onClick={() => signOut({ callbackUrl: '/login' })}
              >
                <span className="inline-flex items-center gap-2">
                  <LogOut className="h-3.5 w-3.5" />
                  Sign Out
                </span>
              </button>
            </div>
          </div>
        ) : resolution.destination === 'REQUEST_ACCESS' && resolution.matchedOrganization ? (
          /* Domain matched, no request yet */
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white shadow-[0_0_30px_rgba(var(--primary-rgb),0.3)]">
                <Building2 className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white">Welcome to InkaTest</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                We&apos;ve matched your email domain (
                <span className="text-zinc-200">@{resolution.domain}</span>) to{' '}
                <strong className="text-zinc-100">{resolution.matchedOrganization.name}</strong>.
              </p>
            </div>

            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-2">
              <p className="text-xs text-zinc-400">
                An administrator will review and assign you to the appropriate workspaces and projects.
              </p>
            </div>

            <div className="space-y-3 pt-1">
              {!showNote ? (
                <button
                  type="button"
                  onClick={() => setShowNote(true)}
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:text-primary/80 font-medium"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add a note
                </button>
              ) : (
                <div className="space-y-2">
                  <label className="text-xs font-medium text-zinc-300" htmlFor="request-note">
                    Anything the admin should know? <span className="text-zinc-500">(optional)</span>
                  </label>
                  <Textarea
                    id="request-note"
                    placeholder="e.g. QA team working on Web App test suites"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    className="bg-white/5 border-white/10 text-zinc-200 placeholder:text-zinc-600 text-sm rounded-xl min-h-[70px] resize-none"
                  />
                </div>
              )}
            </div>

            <div className="space-y-3 pt-2">
              <Button
                onClick={handleRequestAccess}
                disabled={isSubmitting}
                className="w-full h-12 rounded-xl text-base font-semibold gradient-btn text-white"
              >
                {isSubmitting ? (
                  <span className="flex items-center gap-2">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    Submitting Request...
                  </span>
                ) : (
                  <span className="flex items-center gap-2">
                    <ShieldCheck className="h-4 w-4" />
                    Request Access
                  </span>
                )}
              </Button>
            </div>
          </div>
        ) : (
          /* No organization found */
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-zinc-800/80 border border-white/10 flex items-center justify-center text-zinc-400">
                <MailQuestion className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white">No Organization Found</h1>
              <p className="text-sm text-zinc-400 leading-relaxed">
                We couldn&apos;t find an existing workspace for your email domain (
                <span className="text-zinc-300">@{resolution.domain || 'domain'}</span>).
              </p>
            </div>

            <div className="p-5 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-start gap-3">
                <div className="p-2 rounded-lg bg-primary/10 text-primary shrink-0 mt-0.5">
                  <Building2 className="h-4 w-4" />
                </div>
                <div>
                  <p className="text-xs font-semibold text-zinc-200">Need Access?</p>
                  <p className="text-xs text-zinc-400 mt-1 leading-relaxed">
                    Ask your workspace administrator to send you an invitation link by email. You will receive an invite to join directly.
                  </p>
                </div>
              </div>
            </div>

            <div className="pt-2">
              <Button
                variant="ghost"
                className="w-full text-zinc-400 hover:text-zinc-200 h-11 rounded-xl border border-white/10"
                onClick={() => signOut({ callbackUrl: '/login' })}
              >
                <LogOut className="h-4 w-4 mr-2" />
                Sign Out
              </Button>
            </div>
          </div>
        )}

        <div className="mt-8 text-center">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            InkaTest Access Control
          </p>
        </div>
      </div>
    </div>
  );
}
