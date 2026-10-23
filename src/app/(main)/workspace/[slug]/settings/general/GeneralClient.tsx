'use client';

import { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Select } from '@/components/ui/select';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { updateWorkspaceAction, deleteWorkspaceAction } from '@/app/actions/workspace';
import { Trash2, Copy, Check, ChevronDown, Loader2 } from 'lucide-react';

interface GeneralClientProps {
  workspaceId: string;
  initialName: string;
  initialSlug: string;
  organizationName?: string;
  projectCount?: number;
  memberCount?: number;
  createdAt?: string;
}

export function GeneralClient({
  workspaceId,
  initialName,
  initialSlug,
  organizationName = '',
  projectCount = 0,
  memberCount = 0,
}: GeneralClientProps) {
  const router = useRouter();
  const storageKey = `inka_ws_general_${workspaceId}`;

  const [name, setName] = useState(initialName);
  const [slug, setSlug] = useState(initialSlug);
  const [description, setDescription] = useState('');
  const [savedDescription, setSavedDescription] = useState('');
  const [defaultRole, setDefaultRole] = useState<'MEMBER' | 'GUEST'>('MEMBER');
  const [savedDefaultRole, setSavedDefaultRole] = useState<'MEMBER' | 'GUEST'>('MEMBER');

  const [isSaving, setIsSaving] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [confirmDeleteName, setConfirmDeleteName] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed.description !== undefined) {
            setDescription(parsed.description);
            setSavedDescription(parsed.description);
          }
          if (parsed.defaultRole) {
            setDefaultRole(parsed.defaultRole);
            setSavedDefaultRole(parsed.defaultRole);
          }
        }
      } catch {
        // Non-fatal
      }
    }
  }, [storageKey]);

  const hasChanges =
    (name.trim() !== initialName && name.trim().length > 0) ||
    description.trim() !== savedDescription ||
    defaultRole !== savedDefaultRole;

  const handleSave = async () => {
    if (!name.trim()) return;
    setIsSaving(true);
    try {
      let targetSlug = slug;
      if (name.trim() !== initialName) {
        const updated = await updateWorkspaceAction({ workspaceId, name: name.trim() });
        targetSlug = updated.slug;
        setSlug(updated.slug);
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(
          storageKey,
          JSON.stringify({
            description: description.trim(),
            defaultRole,
          })
        );
      }
      setSavedDescription(description.trim());
      setSavedDefaultRole(defaultRole);
      toast.success('Workspace settings saved');
      if (targetSlug !== initialSlug) {
        router.replace(`/workspace/${targetSlug}/settings/general`);
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to update workspace');
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopySlug = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(slug);
      setCopiedSlug(true);
      setTimeout(() => setCopiedSlug(false), 1800);
      toast.success('Workspace slug copied');
    }
  };

  const handleDelete = async () => {
    if (confirmDeleteName !== name) {
      toast.error('Workspace name does not match');
      return;
    }
    setIsDeleting(true);
    try {
      await deleteWorkspaceAction({ workspaceId });
      toast.success('Workspace deleted successfully');
      router.push('/projects');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete workspace');
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border/50 bg-card/20 p-5 space-y-5 shadow-xs">
        {/* Card Header with Save & Actions Dropdown (Replaces Bulky Danger Zone) */}
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-base font-semibold text-foreground">Workspace Settings</h2>
            <p className="text-xs text-muted-foreground mt-0.5">
              Manage workspace identity, member defaults, and organization scope.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!hasChanges || isSaving}
              className="gradient-btn text-white h-8 px-3.5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              {isSaving && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              {isSaving ? 'Saving...' : 'Save changes'}
            </Button>

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5 cursor-pointer"
                  title="Workspace actions"
                >
                  <span>Actions</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48 p-1 rounded-xl">
                <DropdownMenuItem
                  onClick={() => setShowDeleteModal(true)}
                  className="gap-2 px-2.5 py-1.5 text-xs text-rose-500 focus:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Workspace</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* 4-Column Workspace Overview Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl border border-border/50 bg-background/40">
          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Workspace ID
            </span>
            <span className="font-mono text-xs font-bold text-primary">{workspaceId}</span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              URL Slug
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-medium text-foreground truncate">{slug}</span>
              <button
                type="button"
                onClick={handleCopySlug}
                className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                title="Copy workspace slug"
              >
                {copiedSlug ? (
                  <Check className="h-3 w-3 text-emerald-500" />
                ) : (
                  <Copy className="h-3 w-3" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Organization
            </span>
            <span className="text-xs font-medium text-foreground truncate block">
              {organizationName}
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Workspace Scope
            </span>
            <span className="text-xs font-mono text-foreground">
              {projectCount} projects · {memberCount} members
            </span>
          </div>
        </div>

        {/* Editable Fields */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground/90">Workspace Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Engineering QA"
              className="h-9 text-xs bg-background/80 border-input text-foreground"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground/90">
              Default Role for New Members
            </label>
            <Select
              value={defaultRole}
              onValueChange={(val) => setDefaultRole(val as 'MEMBER' | 'GUEST')}
              options={[
                { value: 'MEMBER', label: 'Member (Standard QA access)' },
                { value: 'GUEST', label: 'Guest (Read-only viewer)' },
              ]}
              className="h-9 text-xs"
            />
          </div>

          <div className="sm:col-span-2 space-y-1.5">
            <label className="block text-xs font-semibold text-foreground/90">
              Description <span className="text-muted-foreground font-normal">(Optional)</span>
            </label>
            <Textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Describe the teams, products, or QA scope managed in this workspace..."
              className="text-xs bg-background/80 border-input text-foreground resize-none"
            />
          </div>
        </div>
      </div>

      <ConfirmModal
        open={showDeleteModal}
        onOpenChange={(open) => {
          setShowDeleteModal(open);
          if (!open) setConfirmDeleteName('');
        }}
        title="Delete Workspace"
        description={
          <div className="space-y-3 text-xs text-muted-foreground">
            <p>
              Deleting this workspace is permanent and cannot be undone. All projects, test cases, suites, and runs inside this workspace will be removed. Type{' '}
              <strong className="text-foreground font-mono">&quot;{name}&quot;</strong> to confirm:
            </p>
            <Input
              placeholder="Type workspace name to confirm"
              value={confirmDeleteName}
              onChange={(e) => setConfirmDeleteName(e.target.value)}
              className="h-9 text-xs bg-background border-rose-500/40 focus:border-rose-500 text-foreground"
            />
          </div>
        }
        onConfirm={handleDelete}
        variant="destructive"
        disabled={confirmDeleteName !== name || isDeleting}
      />
    </div>
  );
}
