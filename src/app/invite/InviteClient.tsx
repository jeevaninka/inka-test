'use client';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn, signOut, useSession } from 'next-auth/react';
import { Button } from '@/components/ui/button';
import { acceptInvitationAction } from '@/app/actions/workspace';
import {
  Building2,
  CheckCircle2,
  AlertCircle,
  Clock,
  ArrowRight,
  LogOut,
  Loader2,
  Mail,
} from 'lucide-react';
import { toast } from 'sonner';

interface InviteClientProps {
  status: 'VALID' | 'ACCEPTED' | 'EXPIRED' | 'REVOKED' | 'INVALID';
  token?: string;
  email?: string;
  role?: string;
  workspaceName?: string;
  workspaceSlug?: string;
  organizationName?: string;
  inviterName?: string;
  sessionEmail?: string | null;
  error?: string;
  isOrgInvitation?: boolean;
}

export function InviteClient({
  status,
  token,
  email,
  role,
  workspaceName,
  organizationName,
  inviterName,
  sessionEmail,
  error,
  isOrgInvitation = false,
}: InviteClientProps) {
  const router = useRouter();
  const { data: sessionData, update } = useSession();
  const [isAccepting, setIsAccepting] = useState(false);
  const [authMode, setAuthMode] = useState<'signin' | 'signup'>('signin');
  const [authName, setAuthName] = useState('');
  const [authAgreed, setAuthAgreed] = useState(false);
  const [authPassword, setAuthPassword] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const autoAcceptStarted = useRef(false);

  const inviteUrl = token ? `/invite?token=${token}` : '/invite';
  const currentSessionEmail = (
    sessionData?.user?.email ||
    sessionEmail ||
    ''
  )
    .toLowerCase()
    .trim() || null;
  const normalizedEmail = email?.toLowerCase().trim() || '';
  const isEmailMatch = Boolean(currentSessionEmail && normalizedEmail && currentSessionEmail === normalizedEmail);
  const isEmailMismatch = Boolean(
    currentSessionEmail && normalizedEmail && currentSessionEmail !== normalizedEmail
  );
  const isUnauthenticated = !currentSessionEmail;

  const handleAccept = useCallback(async () => {
    if (!token) return;
    setIsAccepting(true);
    try {
      if (isOrgInvitation) {
        const { acceptOrganizationInvitationAction } = await import('@/app/actions/organization-invitations');
        const res = await acceptOrganizationInvitationAction(token);
        await update();
        toast.success(`Welcome to ${res.organizationName || organizationName || 'the organization'}!`);
        window.location.assign(
          res.firstWorkspaceSlug ? `/workspace/${res.firstWorkspaceSlug}` : '/workspace'
        );
      } else {
        const res = await acceptInvitationAction(token);
        await update();
        toast.success(`Welcome to ${workspaceName}!`);
        window.location.assign(
          res.workspaceSlug ? `/workspace/${res.workspaceSlug}` : '/workspace'
        );
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to accept invitation');
      setIsAccepting(false);
    }
  }, [
    token,
    isOrgInvitation,
    organizationName,
    workspaceName,
    update,
  ]);

  // Once the invited user is authenticated with the matching email, accept
  // automatically. The token is consumed on this pass and the user is sent
  // straight to the workspace - never back to /invite.
  useEffect(() => {
    if (status !== 'VALID' || !token || !isEmailMatch) return;
    if (autoAcceptStarted.current) return;
    autoAcceptStarted.current = true;
    void handleAccept();
  }, [status, token, isEmailMatch, handleAccept]);

  const handleInlineCredentials = async (event: FormEvent) => {
    event.preventDefault();
    setAuthError(null);

    if (authMode === 'signup' && !authName.trim()) {
      setAuthError('Please enter your full name.');
      return;
    }
    if (authMode === 'signup' && !authAgreed) {
      setAuthError('Please accept the Terms of Service and Privacy Policy to create an account.');
      return;
    }

    setAuthBusy(true);
    try {
      const res = await signIn('credentials', {
        email,
        password: authPassword,
        name: authMode === 'signup' ? authName.trim() : undefined,
        action: authMode,
        redirect: false,
        callbackUrl: inviteUrl,
      });

      if (res?.error) {
        throw new Error(res.error);
      }
      if (res?.ok) {
        // Reload the invite page as an authenticated user; the effect above
        // accepts the invitation automatically.
        window.location.assign(inviteUrl);
        return;
      }
      throw new Error('Sign in failed. Please try again.');
    } catch (err: any) {
      setAuthError(err.message || 'Sign in failed. Please try again.');
      setAuthBusy(false);
    }
  };

  const handleGoogle = async () => {
    setAuthError(null);
    setAuthBusy(true);
    try {
      await signIn('google', { callbackUrl: inviteUrl });
    } catch {
      setAuthError('Google sign-in failed. Please try again.');
      setAuthBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#050507] flex flex-col items-center justify-center p-6 relative overflow-hidden text-foreground">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <div className="absolute top-20 left-10 w-72 h-72 bg-primary/20 rounded-full blur-3xl animate-float" />
      <div className="absolute bottom-20 right-10 w-96 h-96 bg-cyan-500/20 rounded-full blur-3xl animate-float animation-delay-300" />

      <div className="relative max-w-[500px] w-full rounded-[2.5rem] border border-white/10 bg-white/5 backdrop-blur-2xl p-10 shadow-2xl animate-scale-in">
        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-3/4 h-px bg-gradient-to-r from-transparent via-primary/50 to-transparent" />

        {/* State: Invalid / Expired / Revoked */}
        {status !== 'VALID' && (
          <div className="text-center space-y-6">
            <div className="mx-auto w-14 h-14 rounded-2xl bg-red-500/10 border border-red-500/20 flex items-center justify-center text-red-400">
              {status === 'EXPIRED' ? (
                <Clock className="w-7 h-7" />
              ) : status === 'ACCEPTED' ? (
                <CheckCircle2 className="w-7 h-7 text-emerald-400" />
              ) : (
                <AlertCircle className="w-7 h-7" />
              )}
            </div>

            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">
                {status === 'ACCEPTED'
                  ? 'Already Accepted'
                  : status === 'EXPIRED'
                  ? 'Invitation Expired'
                  : status === 'REVOKED'
                  ? 'Invitation Revoked'
                  : 'Invalid Link'}
              </h2>
              <p className="text-sm text-zinc-400 leading-relaxed">{error}</p>
            </div>

            <div className="pt-2">
              <Button
                variant="outline"
                onClick={() => router.push('/login')}
                className="w-full h-11 rounded-xl border-white/10 text-zinc-300 hover:text-white"
              >
                Return to Sign In
              </Button>
            </div>
          </div>
        )}

        {/* State: Valid Invitation */}
        {status === 'VALID' && (
          <div className="space-y-6">
            <div className="text-center space-y-3">
              <div className="mx-auto w-14 h-14 rounded-2xl bg-gradient-to-br from-primary to-cyan-500 flex items-center justify-center text-white shadow-[0_0_30px_rgba(var(--primary-rgb),0.3)]">
                <Building2 className="w-7 h-7" />
              </div>
              <h1 className="text-2xl font-bold text-white">Workspace Invitation</h1>
              <p className="text-sm text-zinc-400">
                <strong className="text-zinc-200">{inviterName}</strong> has invited you to join the team on{' '}
                <strong className="text-zinc-200">{organizationName}</strong>.
              </p>
            </div>

            {/* Invite Details Box */}
            <div className="p-4 rounded-2xl bg-white/5 border border-white/10 space-y-3">
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Workspace</span>
                <span className="text-zinc-100 font-semibold">{workspaceName}</span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Assigned Role</span>
                <span className="text-primary font-mono font-medium px-2 py-0.5 rounded bg-primary/10 border border-primary/20">
                  {role}
                </span>
              </div>
              <div className="flex items-center justify-between text-xs">
                <span className="text-zinc-400">Invited Email</span>
                <span className="text-zinc-300">{email}</span>
              </div>
            </div>

            {/* Sub-state A: User logged in with matching email */}
            {isEmailMatch && (
              <div className="space-y-3 pt-2">
                <Button
                  onClick={handleAccept}
                  disabled={isAccepting}
                  className="w-full h-12 rounded-xl text-base font-semibold gradient-btn text-white"
                >
                  {isAccepting ? (
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
                <p className="text-[11px] text-center text-zinc-500">
                  You are signed in as {currentSessionEmail}
                </p>
              </div>
            )}

            {/* Sub-state B: User logged in with different email */}
            {isEmailMismatch && (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-300 text-xs flex items-start gap-2.5">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-400" />
                  <div>
                    <p className="font-semibold">Email Mismatch</p>
                    <p className="mt-0.5 text-amber-300/80">
                      You are signed in as <strong className="text-amber-200">{currentSessionEmail}</strong>, but this invitation was sent to <strong className="text-amber-200">{email}</strong>.
                    </p>
                  </div>
                </div>

                <Button
                  variant="outline"
                  onClick={() => signOut({ callbackUrl: inviteUrl })}
                  className="w-full h-11 rounded-xl border-white/10 text-zinc-300 hover:text-white flex items-center justify-center gap-2"
                >
                  <LogOut className="h-4 w-4" />
                  Switch to Invited Account
                </Button>
              </div>
            )}

            {/* Sub-state C: Not logged in — authenticate inline without leaving the invite */}
            {isUnauthenticated && (
              <div className="space-y-4 pt-2">
                <div className="p-3 rounded-xl bg-white/5 border border-white/10 flex items-center gap-2.5">
                  <Mail className="h-4 w-4 text-primary shrink-0" />
                  <div className="min-w-0">
                    <p className="text-[10px] uppercase tracking-wider text-zinc-500">Invitation locked to</p>
                    <p className="text-xs text-zinc-200 truncate">{email}</p>
                  </div>
                </div>

                <button
                  className="w-full h-11 rounded-xl border border-white/10 bg-white/5 text-sm font-semibold text-zinc-200 hover:bg-white/10 transition-colors flex items-center justify-center gap-2"
                  onClick={handleGoogle}
                  disabled={authBusy}
                  type="button"
                >
                  {authBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <GoogleMark />}
                  Continue with Google
                </button>

                <div className="flex items-center gap-3">
                  <div className="h-px flex-1 bg-white/10" />
                  <span className="text-[10px] uppercase tracking-wider text-zinc-600">or</span>
                  <div className="h-px flex-1 bg-white/10" />
                </div>

                <div className="grid grid-cols-2 gap-1 rounded-xl bg-white/5 p-1 border border-white/10">
                  {(['signin', 'signup'] as const).map((mode) => (
                    <button
                      key={mode}
                      type="button"
                      onClick={() => {
                        setAuthMode(mode);
                        setAuthError(null);
                      }}
                      className={`h-8 rounded-lg text-xs font-semibold transition-colors ${
                        authMode === mode
                          ? 'bg-primary text-primary-foreground'
                          : 'text-zinc-400 hover:text-zinc-200'
                      }`}
                    >
                      {mode === 'signin' ? 'Sign In' : 'Create Account'}
                    </button>
                  ))}
                </div>

                <form className="space-y-3" onSubmit={handleInlineCredentials}>
                  {authMode === 'signup' && (
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-medium text-zinc-400" htmlFor="invite-name">
                        Full name
                      </label>
                      <input
                        id="invite-name"
                        type="text"
                        autoComplete="name"
                        value={authName}
                        onChange={(e) => setAuthName(e.target.value)}
                        required
                        className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 outline-none focus:border-primary/50"
                      />
                    </div>
                  )}
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-zinc-400" htmlFor="invite-email">
                      Email
                    </label>
                    <input
                      id="invite-email"
                      type="email"
                      value={email || ''}
                      disabled
                      className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-400 cursor-not-allowed"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-[11px] font-medium text-zinc-400" htmlFor="invite-password">
                      Password
                    </label>
                    <input
                      id="invite-password"
                      type="password"
                      autoComplete={authMode === 'signin' ? 'current-password' : 'new-password'}
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      required
                      className="w-full h-10 rounded-xl border border-white/10 bg-white/5 px-3 text-sm text-zinc-100 outline-none focus:border-primary/50"
                    />
                  </div>

                  {authMode === 'signin' && (
                    <div className="flex justify-end">
                      <a
                        href={`/forgot-password${email ? `?email=${encodeURIComponent(email)}` : ''}`}
                        className="text-[11px] font-semibold text-primary hover:underline"
                        target="_blank"
                        rel="noopener noreferrer"
                      >
                        Forgot password?
                      </a>
                    </div>
                  )}

                  {authMode === 'signup' && (
                    <p className="text-[11px] leading-relaxed text-zinc-500">
                      By creating an account you agree to the{' '}
                      <a
                        href="/legal/terms"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Terms of Service
                      </a>{' '}
                      and{' '}
                      <a
                        href="/legal/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary hover:underline"
                      >
                        Privacy Policy
                      </a>
                      .
                    </p>
                  )}

                  {authError && (
                    <p className="text-xs text-red-400 flex items-start gap-1.5">
                      <AlertCircle className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                      {authError}
                    </p>
                  )}

                  <Button
                    type="submit"
                    disabled={authBusy}
                    className="w-full h-11 rounded-xl font-semibold gradient-btn text-white"
                  >
                    {authBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <>
                        {authMode === 'signin' ? 'Sign In & Join' : 'Create Account & Join'}
                        <ArrowRight className="h-4 w-4 ml-2" />
                      </>
                    )}
                  </Button>
                </form>

                <p className="text-[11px] text-center text-zinc-500">
                  We&apos;ll accept the invitation automatically after you sign in.
                </p>
              </div>
            )}
          </div>
        )}

        <div className="mt-8 text-center space-y-2">
          <p className="text-[10px] font-mono text-zinc-600 uppercase tracking-widest">
            InkaTest Access Control
          </p>
          <div className="flex items-center justify-center gap-3 text-[11px] text-zinc-500">
            <a href="/legal/terms" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">
              Terms of Service
            </a>
            <span aria-hidden>·</span>
            <a href="/legal/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-zinc-300">
              Privacy Policy
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}
