'use client';

import { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Globe, ExternalLink, Check, Pencil, AlertCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/common/DataTable';
import {
  getEnvironmentsAction,
  createEnvironmentAction,
  updateEnvironmentAction,
  deleteEnvironmentAction,
} from '@/app/actions/variables';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { cn } from '@/lib/utils';

interface EnvironmentsPageProps {
  projectId: string;
}

const COLOR_OPTIONS = [
  { value: 'blue', label: 'Blue (Dev)', bg: 'bg-blue-500/15', text: 'text-blue-600 dark:text-blue-400', border: 'border-blue-500/30' },
  { value: 'amber', label: 'Amber (Staging)', bg: 'bg-amber-500/15', text: 'text-amber-600 dark:text-amber-400', border: 'border-amber-500/30' },
  { value: 'emerald', label: 'Emerald (Prod)', bg: 'bg-emerald-500/15', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500/30' },
  { value: 'sky', label: 'Sky', bg: 'bg-sky-500/15', text: 'text-sky-600 dark:text-sky-400', border: 'border-sky-500/30' },
  { value: 'purple', label: 'Purple', bg: 'bg-purple-500/15', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500/30' },
  { value: 'rose', label: 'Rose', bg: 'bg-rose-500/15', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500/30' },
];

export function EnvironmentsPage({ projectId }: EnvironmentsPageProps) {
  const [environments, setEnvironments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showDialog, setShowDialog] = useState(false);
  const [editingEnv, setEditingEnv] = useState<any | null>(null);
  const [envToDelete, setEnvToDelete] = useState<any | null>(null);

  const [formName, setFormName] = useState('');
  const [formDescription, setFormDescription] = useState('');
  const [formBaseUrl, setFormBaseUrl] = useState('');
  const [formColor, setFormColor] = useState('blue');
  const [formIsDefault, setFormIsDefault] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getEnvironmentsAction(projectId);
      setEnvironments(data);
    } catch (e: any) {
      toast.error('Failed to load environments');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formName.trim()) {
      toast.error('Environment name is required');
      return;
    }

    try {
      if (editingEnv) {
        await updateEnvironmentAction(editingEnv.id, {
          name: formName.trim().toUpperCase(),
          description: formDescription,
          baseUrl: formBaseUrl,
          color: formColor,
          isDefault: formIsDefault,
        });
        toast.success(`Environment "${formName.toUpperCase()}" updated`);
      } else {
        await createEnvironmentAction({
          projectId,
          name: formName.trim().toUpperCase(),
          description: formDescription,
          baseUrl: formBaseUrl,
          color: formColor,
          isDefault: formIsDefault,
        });
        toast.success(`Environment "${formName.toUpperCase()}" created`);
      }
      setShowDialog(false);
      setEditingEnv(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save environment');
    }
  };

  const confirmDelete = async () => {
    if (!envToDelete) return;
    try {
      await deleteEnvironmentAction(envToDelete.id);
      toast.success(`Environment "${envToDelete.name}" deleted`);
      setEnvToDelete(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete environment');
    }
  };

  const openCreate = () => {
    setEditingEnv(null);
    setFormName('');
    setFormDescription('');
    setFormBaseUrl('');
    setFormColor('blue');
    setFormIsDefault(environments.length === 0);
    setShowDialog(true);
  };

  const openEdit = (env: any) => {
    setEditingEnv(env);
    setFormName(env.name);
    setFormDescription(env.description || '');
    setFormBaseUrl(env.base_url || '');
    setFormColor(env.color || 'blue');
    setFormIsDefault(Boolean(env.is_default));
    setShowDialog(true);
  };

  const columns = [
    {
      id: 'name',
      header: 'Environment',
      accessor: (row: any) => {
        const colorCfg = COLOR_OPTIONS.find((c) => c.value === row.color) || COLOR_OPTIONS[0];
        return (
          <div className="flex items-center gap-2">
            <span
              className={cn(
                'px-2.5 py-0.5 rounded-full text-xs font-mono font-bold uppercase border',
                colorCfg.bg,
                colorCfg.text,
                colorCfg.border
              )}
            >
              {row.name}
            </span>
            {row.is_default && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-primary/10 text-primary font-semibold">
                Default
              </span>
            )}
          </div>
        );
      },
    },
    {
      id: 'baseUrl',
      header: 'Base URL',
      accessor: (row: any) =>
        row.base_url ? (
          <a
            href={row.base_url.startsWith('http') ? row.base_url : `https://${row.base_url}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-mono text-sky-600 dark:text-sky-400 hover:underline inline-flex items-center gap-1"
          >
            <span className="truncate max-w-[200px]">{row.base_url}</span>
            <ExternalLink className="h-3 w-3 shrink-0 opacity-70" />
          </a>
        ) : (
          <span className="text-muted-foreground/40 text-xs">—</span>
        ),
    },
    {
      id: 'description',
      header: 'Description',
      accessor: (row: any) => (
        <span className="text-xs text-muted-foreground truncate block max-w-xs">
          {row.description || '—'}
        </span>
      ),
    },
    {
      id: 'values',
      header: 'Configured Variables',
      accessor: (row: any) => (
        <span className="text-xs px-2 py-0.5 rounded-md bg-muted font-mono font-medium">
          {row._count?.variable_values || 0} values
        </span>
      ),
    },
    {
      id: 'actions',
      header: '',
      accessor: (row: any) => (
        <div className="flex gap-1 justify-end">
          <Button variant="ghost" size="sm" onClick={() => openEdit(row)}>
            <Pencil className="h-3.5 w-3.5 mr-1" />
            Edit
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive hover:bg-destructive/10"
            onClick={() => setEnvToDelete(row)}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Environments</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure deployment targets (DEV, STAGING, PROD) and base URLs for variable resolution
          </p>
        </div>
        <Button onClick={openCreate} size="sm">
          <Plus className="h-4 w-4 mr-1.5" />
          New Environment
        </Button>
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        <DataTable
          data={environments}
          columns={columns}
          getId={(r) => r.id}
          loading={loading}
          tableClassName="w-full min-w-[600px]"
          emptyComponent={
            <div className="py-12 text-center space-y-3">
              <Globe className="h-8 w-8 text-muted-foreground mx-auto" />
              <p className="text-sm font-semibold">No environments found</p>
              <p className="text-xs text-muted-foreground max-w-sm mx-auto">
                Create environments like DEV, STAGING, and PRODUCTION to assign environment-specific variable values.
              </p>
              <Button size="sm" onClick={openCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Create First Environment
              </Button>
            </div>
          }
        />
      </div>

      {/* Edit / Create Dialog */}
      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="max-w-md bg-card border border-border/80 shadow-2xl p-6">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingEnv ? 'Edit Environment' : 'Create Environment'}
            </DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Environment Name
              </label>
              <Input
                value={formName}
                onChange={(e) => setFormName(e.target.value.toUpperCase())}
                placeholder="e.g. DEV, STAGING, PRODUCTION, UAT"
                className="font-mono text-sm uppercase"
                required
                autoFocus
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Base URL (optional)
              </label>
              <Input
                value={formBaseUrl}
                onChange={(e) => setFormBaseUrl(e.target.value)}
                placeholder="e.g. https://staging.app.example.com"
                className="font-mono text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Description (optional)
              </label>
              <Input
                value={formDescription}
                onChange={(e) => setFormDescription(e.target.value)}
                placeholder="What this environment is used for"
                className="text-xs"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1.5">
                Badge Color
              </label>
              <div className="grid grid-cols-3 gap-2">
                {COLOR_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => setFormColor(opt.value)}
                    className={cn(
                      'px-2 py-1.5 rounded-lg border text-xs font-medium flex items-center justify-between transition-all cursor-pointer',
                      opt.bg,
                      opt.text,
                      opt.border,
                      formColor === opt.value ? 'ring-2 ring-primary ring-offset-1' : 'opacity-70 hover:opacity-100'
                    )}
                  >
                    <span>{opt.label.split(' ')[0]}</span>
                    {formColor === opt.value && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            </div>

            <div className="pt-2 border-t border-border/40">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground">
                <input
                  type="checkbox"
                  checked={formIsDefault}
                  onChange={(e) => setFormIsDefault(e.target.checked)}
                  className="rounded border-border/50 text-primary"
                />
                <span>Set as default environment for new test runs</span>
              </label>
            </div>

            <DialogFooter className="pt-3 border-t border-border/40">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowDialog(false)}>
                Cancel
              </Button>
              <Button type="submit" size="sm">
                {editingEnv ? 'Update' : 'Create'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Safe Delete Confirmation */}
      {envToDelete && (
        <ConfirmModal
          open={!!envToDelete}
          onOpenChange={(open) => !open && setEnvToDelete(null)}
          title={`Delete Environment "${envToDelete.name}"`}
          description={
            envToDelete._count?.variable_values > 0
              ? `Warning: Deleting "${envToDelete.name}" will permanently erase ${envToDelete._count.variable_values} variable values configured for this environment. Are you sure you want to proceed?`
              : `Are you sure you want to delete environment "${envToDelete.name}"? This action cannot be undone.`
          }
          confirmLabel="Delete Environment"
          variant="destructive"
          onConfirm={confirmDelete}
        />
      )}
    </div>
  );
}
