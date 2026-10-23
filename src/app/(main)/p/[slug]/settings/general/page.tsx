"use client";

import { useState, useEffect, useMemo } from 'react';
import { useRouter, useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Loader2, Archive, Trash2, Copy, Check, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  updateProjectDetailsAction,
  archiveProjectAction,
  deleteProjectAction,
} from '@/app/actions/projects';

export default function GeneralSettingsPage() {
  const router = useRouter();
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const { project, cases = [], suites = [], runs = [], members = [] } = useProjectData();
  const projectIdOrSlug = project?.id || slug;

  const descStorageKey = `inka_project_desc_${projectIdOrSlug}`;

  const [name, setName] = useState<string>(() => project?.name || '');
  const [savedDescription, setSavedDescription] = useState('');
  const [description, setDescription] = useState('');

  const [savingDetails, setSavingDetails] = useState(false);
  const [showArchiveModal, setShowArchiveModal] = useState(false);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [copiedSlug, setCopiedSlug] = useState(false);

  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const storedDesc = localStorage.getItem(descStorageKey) || '';
        setSavedDescription(storedDesc);
        setDescription(storedDesc);
      } catch {
        // Non-fatal
      }
    }
  }, [descStorageKey]);

  const casePrefix = useMemo(() => {
    if (project?.key && project.key !== 'PRJ') return String(project.key).toUpperCase();
    const firstCaseId = cases[0]?.displayId;
    if (firstCaseId && String(firstCaseId).includes('-')) {
      return String(firstCaseId).split('-')[0].toUpperCase();
    }
    return String(project?.key || slug.slice(0, 3)).toUpperCase();
  }, [project?.key, cases, slug]);

  const currentProjectName = (project?.name || '').trim();
  const hasChanges =
    (name.trim() !== currentProjectName && name.trim().length > 0) ||
    description.trim() !== savedDescription;

  const handleSaveDetails = async () => {
    if (!name.trim()) {
      toast.error('Project name cannot be empty');
      return;
    }
    setSavingDetails(true);
    try {
      if (name.trim() !== currentProjectName) {
        await updateProjectDetailsAction(projectIdOrSlug, {
          name: name.trim(),
          description: description.trim(),
        });
      }
      if (typeof window !== 'undefined') {
        localStorage.setItem(descStorageKey, description.trim());
      }
      setSavedDescription(description.trim());
      toast.success('Project details saved');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to update project details';
      toast.error(message);
    } finally {
      setSavingDetails(false);
    }
  };

  const handleCopySlug = () => {
    if (typeof window !== 'undefined') {
      navigator.clipboard.writeText(slug);
      setCopiedSlug(true);
      setTimeout(() => setCopiedSlug(false), 1800);
      toast.success('Project slug copied');
    }
  };

  const handleArchive = async () => {
    setArchiving(true);
    try {
      await archiveProjectAction(projectIdOrSlug);
      toast.success('Project archived');
      router.push('/projects');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to archive project';
      toast.error(message);
      setArchiving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await deleteProjectAction(projectIdOrSlug);
      toast.success('Project deleted');
      router.push('/projects');
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to delete project';
      toast.error(message);
      setDeleting(false);
    }
  };

  if (!project) return null;

  return (
    <div className="space-y-5">
      {/* Strictly Project Identity & Overview Card */}
      <div className="rounded-xl border border-border/50 bg-card/20 p-5 space-y-5 shadow-xs">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h3 className="font-semibold text-sm text-foreground">Project Identity</h3>
            <p className="text-xs text-muted-foreground mt-0.5">
              Project name, key prefix, URL slug, and repository summary.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={handleSaveDetails}
              disabled={!hasChanges || savingDetails}
              className="gradient-btn text-white h-8 px-3.5 text-xs font-semibold disabled:opacity-40 cursor-pointer"
            >
              {savingDetails && <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />}
              Save changes
            </Button>

            {/* Labeled Actions Dropdown for Archive & Delete */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-8 px-3 text-xs gap-1.5 cursor-pointer"
                  title="Archive or delete this project"
                >
                  <span>Actions</span>
                  <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44 p-1 rounded-xl">
                <DropdownMenuItem
                  onClick={() => setShowArchiveModal(true)}
                  className="gap-2 px-2.5 py-1.5 text-xs text-foreground cursor-pointer"
                >
                  <Archive className="h-3.5 w-3.5 text-muted-foreground" />
                  <span>Archive Project</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowDeleteModal(true)}
                  className="gap-2 px-2.5 py-1.5 text-xs text-rose-500 focus:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Delete Project</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>

        {/* Compact 4-Column Project Metadata Strip */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 p-3.5 rounded-xl border border-border/50 bg-background/40">
          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Case Prefix
            </span>
            <div className="flex items-center gap-1.5">
              <span className="font-mono text-xs font-bold text-primary">{casePrefix}</span>
              <span className="text-[11px] font-mono text-muted-foreground">({casePrefix}-1)</span>
            </div>
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
                title="Copy project slug"
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
              Repository
            </span>
            <span className="text-xs font-mono text-foreground">
              {cases.length} cases · {suites.length} suites
            </span>
          </div>

          <div className="space-y-0.5">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground block">
              Activity &amp; Team
            </span>
            <span className="text-xs font-mono text-foreground">
              {runs.length} runs · {members.length} members
            </span>
          </div>
        </div>

        {/* Editable Identity Fields */}
        <div className="space-y-4">
          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground/90">Project Name</label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Project name"
              className="h-9 text-xs bg-background/80 border-input text-foreground max-w-md"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold text-foreground/90">
              Description <span className="text-muted-foreground font-normal">(Optional)</span>
            </label>
            <Textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What does this project cover?"
              className="text-xs bg-background/80 border-input text-foreground resize-none"
            />
          </div>
        </div>
      </div>

      {/* Confirmation Modals */}
      <ConfirmModal
        open={showArchiveModal}
        onOpenChange={setShowArchiveModal}
        title="Archive Project"
        description="Are you sure you want to archive this project? It will be hidden from the workspace and can be restored later."
        confirmLabel={archiving ? 'Archiving...' : 'Archive Project'}
        onConfirm={handleArchive}
      />

      <ConfirmModal
        open={showDeleteModal}
        onOpenChange={setShowDeleteModal}
        title="Delete Project"
        description="This will permanently delete this project and all its test cases, suites, and test runs. This action cannot be undone."
        confirmLabel={deleting ? 'Deleting...' : 'Delete Project Permanently'}
        variant="destructive"
        requireTypedConfirmation="DELETE"
        onConfirm={handleDelete}
      />
    </div>
  );
}
