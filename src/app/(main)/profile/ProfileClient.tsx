'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { TopBar } from '@/components/layout/TopBar';
import { Sidebar, type WorkspaceState } from '@/components/layout/Sidebar';
import { toast } from 'sonner';
import { updateProfileAction } from '@/app/actions/workspace';
import { updateNotificationPrefsAction } from '@/app/actions/notifications';
import { User, Palette, Type, Bell } from 'lucide-react';

const AVATAR_COLORS = [
  '#6366f1', // indigo
  '#8b5cf6', // violet
  '#ec4899', // pink
  '#ef4444', // red
  '#f97316', // orange
  '#eab308', // yellow
  '#22c55e', // green
  '#06b6d4', // cyan
  '#3b82f6', // blue
  '#14b8a6', // teal
];

interface ProfileClientProps {
  user: {
    id: number;
    name: string;
    displayName: string | null;
    email: string;
    image: string | null;
    avatarColor: string | null;
    avatarInitials: string | null;
    role?: string;
    workspaceName?: string;
  };
  prefs: {
    emailMentions: boolean;
    emailReviewRequests: boolean;
    emailRunComplete: boolean;
  } | null;
  initialWorkspace?: WorkspaceState | null;
}

export function ProfileClient({ user, prefs, initialWorkspace = null }: ProfileClientProps) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(user.displayName || '');
  const [avatarColor, setAvatarColor] = useState(user.avatarColor || AVATAR_COLORS[0]);
  const [avatarInitials, setAvatarInitials] = useState(user.avatarInitials || '');
  const [emailMentions, setEmailMentions] = useState(prefs?.emailMentions ?? true);
  const [emailReviewRequests, setEmailReviewRequests] = useState(prefs?.emailReviewRequests ?? true);
  const [emailRunComplete, setEmailRunComplete] = useState(prefs?.emailRunComplete ?? false);
  const [isSaving, setIsSaving] = useState(false);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    const handleToggle = (e: any) => {
      setCollapsed(e.detail?.collapsed ?? false);
    };
    if (typeof window !== 'undefined') {
      setCollapsed(localStorage.getItem('inka_sidebar_collapsed') === 'true');
    }
    window.addEventListener('sidebar-toggle', handleToggle);
    return () => window.removeEventListener('sidebar-toggle', handleToggle);
  }, []);

  // Standardize auto-initials from full name ("Jeevan Kumar" -> "JK")
  const autoInitials = (() => {
    const source = (user.name || displayName || 'User').trim();
    const parts = source.split(/\s+/);
    if (parts.length >= 2) {
      return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    return parts[0].slice(0, 2).toUpperCase();
  })();

  const displayInitials = (avatarInitials || '').trim().toUpperCase() || autoInitials;

  const handleSave = async () => {
    setIsSaving(true);
    try {
      await Promise.all([
        updateProfileAction({
          displayName,
          avatarColor,
          avatarInitials: avatarInitials.trim() ? avatarInitials.trim().toUpperCase() : undefined,
        }),
        updateNotificationPrefsAction({
          email_mentions: emailMentions,
          email_review_requests: emailReviewRequests,
          email_run_complete: emailRunComplete,
        }),
      ]);
      toast.success('Profile and notification preferences updated');
      router.refresh();
    } catch (err: any) {
      toast.error(err.message || 'Failed to update profile');
    } finally {
      setIsSaving(false);
    }
  };

  const hasChanges =
    displayName !== (user.displayName || '') ||
    avatarColor !== (user.avatarColor || AVATAR_COLORS[0]) ||
    avatarInitials !== (user.avatarInitials || '') ||
    emailMentions !== (prefs?.emailMentions ?? true) ||
    emailReviewRequests !== (prefs?.emailReviewRequests ?? true) ||
    emailRunComplete !== (prefs?.emailRunComplete ?? false);

  return (
    <div className="min-h-screen bg-background relative overflow-x-hidden">
      <div className="absolute inset-0 mesh-gradient opacity-60" />
      <Sidebar initialWorkspace={initialWorkspace} />
      <TopBar breadcrumbs={[{ label: 'Profile' }]} />

      <main className={cn("relative pt-14 transition-all duration-300", collapsed ? "md:pl-16" : "md:pl-48")}>
        <div className="max-w-2xl mx-auto p-6 sm:p-8">
          <div className="mb-8">
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-3xl font-bold tracking-tight text-foreground">Profile</h1>
              {user.role && (
                <span className="px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider bg-primary/15 text-primary border border-primary/25">
                  {user.role}
                </span>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Manage your display name, appearance, and account details.
            </p>
          </div>

          <div className="space-y-6">
            {/* Avatar Preview */}
            <div className="glass rounded-2xl border border-border/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Avatar</h3>
              </div>

              <div className="flex items-center gap-6">
                <div
                  className="w-20 h-20 rounded-2xl flex items-center justify-center text-white text-2xl font-bold shadow-lg transition-colors duration-300 shrink-0"
                  style={{ backgroundColor: avatarColor }}
                >
                  {displayInitials}
                </div>

                <div className="flex-1 space-y-4">
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Type className="h-4 w-4 text-muted-foreground" />
                      Custom Initials
                    </label>
                    <Input
                      value={avatarInitials}
                      onChange={(e) => setAvatarInitials(e.target.value.toUpperCase())}
                      placeholder={`Auto: ${autoInitials}`}
                      maxLength={2}
                      className="bg-white/5 border-border/60 text-foreground placeholder:text-muted-foreground w-32 font-mono uppercase"
                    />
                    <p className="text-xs text-muted-foreground">
                      Leave empty to auto-generate from name ({autoInitials}).
                    </p>
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-foreground flex items-center gap-1.5">
                      <Palette className="h-4 w-4 text-muted-foreground" />
                      Color
                    </label>
                    <div className="flex gap-2 flex-wrap">
                      {AVATAR_COLORS.map((color) => (
                        <button
                          key={color}
                          type="button"
                          onClick={() => setAvatarColor(color)}
                          className={cn(
                            "w-7 h-7 rounded-lg transition-all duration-200 cursor-pointer",
                            avatarColor === color
                              ? "ring-2 ring-foreground ring-offset-2 ring-offset-background scale-110"
                              : "hover:scale-105 opacity-80 hover:opacity-100"
                          )}
                          style={{ backgroundColor: color }}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            </div>

            {/* Account Details */}
            <div className="glass rounded-2xl border border-border/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <User className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Account Details</h3>
              </div>

              <div className="space-y-4 max-w-md">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Name</label>
                  <Input
                    value={user.name}
                    disabled
                    className="bg-muted/40 border-transparent text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Name is read-only.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Display Name</label>
                  <Input
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your preferred display name"
                    className="bg-background border-border/60 text-foreground placeholder:text-muted-foreground"
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Email</label>
                  <Input
                    value={user.email}
                    disabled
                    className="bg-muted/40 border-transparent text-muted-foreground"
                  />
                  <p className="text-xs text-muted-foreground">
                    Email cannot be changed here.
                  </p>
                </div>

                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-foreground">Role</label>
                  <Input
                    value={user.role || 'Member'}
                    disabled
                    className="bg-muted/40 border-transparent text-muted-foreground capitalize"
                  />
                  <p className="text-xs text-muted-foreground">
                    Your assigned role in {user.workspaceName || 'the workspace'}.
                  </p>
                </div>
              </div>
            </div>

            {/* Notification Preferences */}
            <div className="glass rounded-2xl border border-border/50 p-6">
              <div className="flex items-center gap-2 mb-4">
                <Bell className="h-5 w-5 text-primary" />
                <h3 className="text-lg font-semibold text-foreground">Notification Preferences</h3>
              </div>

              <div className="space-y-4 max-w-md">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">Email on @Mentions</p>
                    <p className="text-xs text-muted-foreground">Receive email when someone mentions you</p>
                  </div>
                  <Switch checked={emailMentions} onCheckedChange={setEmailMentions} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">Email on Review Requests</p>
                    <p className="text-xs text-muted-foreground">Receive email when a review is requested from you</p>
                  </div>
                  <Switch checked={emailReviewRequests} onCheckedChange={setEmailReviewRequests} />
                </div>

                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <p className="text-sm font-medium text-foreground">Email on Run Completions</p>
                    <p className="text-xs text-muted-foreground">Receive email when a test run you created completes</p>
                  </div>
                  <Switch checked={emailRunComplete} onCheckedChange={setEmailRunComplete} />
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex justify-end pt-2">
              <Button
                onClick={handleSave}
                disabled={isSaving || !hasChanges}
                className="btn-glow px-8"
              >
                {isSaving ? 'Saving...' : 'Save Changes'}
              </Button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
