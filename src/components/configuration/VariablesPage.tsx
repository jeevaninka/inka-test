'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import {
  Plus,
  Trash2,
  X,
  Info,
  Loader2,
  Copy,
  Pencil,
  Search,
  Check,
  Globe,
  SlidersHorizontal,
  Lock,
  Eye,
  EyeOff,
  Paperclip,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  getGlobalVariablesAction,
  getPostmanVariablesAction,
  getEnvironmentsAction,
  createVariableAction,
  createPostmanVariableAction,
  updateVariableAction,
  deleteVariableAction,
  setVariableValueAction,
  createEnvironmentAction,
  getVariableUsageAction,
  uploadVariableAttachmentAction,
} from '@/app/actions/variables';
import { PostmanLogo } from '@/components/icons/IntegrationLogos';
import { toast } from 'sonner';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { cn, formatVariableName } from '@/lib/utils';

interface VariablesPageProps {
  projectId: string;
}

export function VariablesPage({ projectId }: VariablesPageProps) {
  const params = useParams();
  const { project } = useProjectData();
  const slug = (params?.slug as string) || project?.slug || projectId;

  const [variables, setVariables] = useState<any[]>([]);
  const [postmanVariables, setPostmanVariables] = useState<any[]>([]);
  const [activeTab, setActiveTab] = useState<'global' | 'postman'>('global');
  const [environments, setEnvironments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showAddVarModal, setShowAddVarModal] = useState(false);
  const [editingVariable, setEditingVariable] = useState<any>(null);
  const [showAddEnvModal, setShowAddEnvModal] = useState(false);
  const [newEnvName, setNewEnvName] = useState('');
  const [showUsageDrawer, setShowUsageDrawer] = useState<string | null>(null);
  const [usageCases, setUsageCases] = useState<any[]>([]);
  const [copiedValueKey, setCopiedValueKey] = useState<string | null>(null);
  const [showAllSecrets, setShowAllSecrets] = useState(false);
  const [confirmConfig, setConfirmConfig] = useState<{
    open: boolean;
    title: string;
    description: string;
    confirmLabel: string;
    variant?: 'default' | 'destructive';
    onConfirm: () => void;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [vars, pmVars, envs] = await Promise.all([
        getGlobalVariablesAction(projectId),
        getPostmanVariablesAction(projectId),
        getEnvironmentsAction(projectId),
      ]);
      setVariables(vars);
      setPostmanVariables(pmVars);
      setEnvironments(envs);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load variables');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const handleAddVariable = () => {
    setEditingVariable(null);
    setShowAddVarModal(true);
  };

  const handleEditVariable = (variable: any) => {
    setEditingVariable(variable);
    setShowAddVarModal(true);
  };

  const handleDeleteVariable = async (variable: any) => {
    const usageCount = variables.find((v) => v.id === variable.id)?.usage_count || 0;

    const executeDelete = async () => {
      try {
        await deleteVariableAction(variable.id);
        toast.success(`Deleted variable "${variable.key}"`);
        await load();
      } catch (err: any) {
        toast.error(err.message || 'Failed to delete variable');
      }
    };

    if (usageCount > 0) {
      setConfirmConfig({
        open: true,
        title: 'Delete Variable',
        description: `"${variable.key}" is used in ${usageCount} test case(s). Deleting it may cause test execution errors. Are you sure?`,
        confirmLabel: 'Delete',
        variant: 'destructive',
        onConfirm: executeDelete,
      });
    } else {
      executeDelete();
    }
  };

  const handleAddEnvironment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newEnvName.trim()) {
      toast.error('Environment name is required');
      return;
    }

    try {
      await createEnvironmentAction({ projectId, name: newEnvName.trim().toUpperCase() });
      toast.success(`Environment "${newEnvName.trim().toUpperCase()}" created`);
      setNewEnvName('');
      setShowAddEnvModal(false);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to create environment');
    }
  };

  const handleSaveVariable = async (formData: any) => {
    try {
      if (editingVariable) {
        await updateVariableAction(editingVariable.id, {
          key: formData.key,
          description: formData.description,
          defaultValue: formData.defaultValue,
          isSecret: formData.isSecret,
        });
        for (const env of environments) {
          const value = formData.values?.[env.id] !== undefined ? formData.values[env.id] : '';
          await setVariableValueAction({ variableId: editingVariable.id, environmentId: env.id, value });
        }
        toast.success(`Variable "${formData.key}" updated`);
      } else {
        const variable =
          activeTab === 'postman'
            ? await createPostmanVariableAction({
                projectId,
                key: formData.key,
                description: formData.description,
                defaultValue: formData.defaultValue,
                isSecret: formData.isSecret,
              })
            : await createVariableAction({
                projectId,
                key: formData.key,
                scope: 'GLOBAL',
                description: formData.description,
                defaultValue: formData.defaultValue,
                isSecret: formData.isSecret,
              });

        for (const env of environments) {
          const value = formData.values?.[env.id] || '';
          if (value) {
            await setVariableValueAction({ variableId: variable.id, environmentId: env.id, value });
          }
        }
        toast.success(
          `${activeTab === 'postman' ? 'Postman variable' : 'Variable'} "${formData.key}" created`
        );
      }
      setShowAddVarModal(false);
      setEditingVariable(null);
      await load();
    } catch (err: any) {
      toast.error(err.message || 'Failed to save variable');
    }
  };

  const handleViewUsage = async (variable: any) => {
    try {
      const cases = await getVariableUsageAction(projectId, variable.key);
      setUsageCases(cases);
      setShowUsageDrawer(variable.key);
    } catch (err: any) {
      toast.error('Failed to load variable usage');
    }
  };

  const handleCopyValue = (key: string, val: string, e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(val);
    setCopiedValueKey(key);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedValueKey(null), 2000);
  };

  const activeList = activeTab === 'postman' ? postmanVariables : variables;

  const filteredVariables = useMemo(() => {
    if (!search.trim()) return activeList;
    const q = search.toLowerCase().trim();
    return activeList.filter((v) => {
      if (v.key.toLowerCase().includes(q)) return true;
      if (v.description && v.description.toLowerCase().includes(q)) return true;
      if (v.values && Array.isArray(v.values)) {
        return v.values.some((val: any) => (val.value || '').toLowerCase().includes(q));
      }
      return false;
    });
  }, [activeList, search]);

  if (environments.length === 0 && !loading) {
    return (
      <div className="space-y-6">
        <div>
          <h2 className="text-xl font-bold">Global Variables</h2>
          <p className="text-sm text-muted-foreground">Manage global variables shared across test cases</p>
        </div>
        <div className="bg-card border border-border/60 rounded-2xl p-8 text-center max-w-md mx-auto shadow-xs space-y-4">
          <div className="h-12 w-12 rounded-2xl bg-primary/10 text-primary flex items-center justify-center mx-auto">
            <Globe className="h-6 w-6" />
          </div>
          <div>
            <h3 className="font-bold text-base text-foreground">No Environments Defined</h3>
            <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
              Variables store environment-specific values (e.g. URLs, tokens). Create your first environment to begin.
            </p>
          </div>
          <Button onClick={() => setShowAddEnvModal(true)} className="w-full">
            <Plus className="h-4 w-4 mr-2" />
            Create First Environment
          </Button>
        </div>

        {/* Add Environment Dialog */}
        <Dialog open={showAddEnvModal} onOpenChange={setShowAddEnvModal}>
          <DialogContent className="max-w-md bg-card text-card-foreground border border-border/80 shadow-2xl">
            <DialogHeader>
              <DialogTitle className="text-base font-semibold">New Environment</DialogTitle>
            </DialogHeader>
            <form onSubmit={handleAddEnvironment} className="space-y-4 py-2">
              <div>
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                  Environment Name
                </label>
                <Input
                  placeholder="e.g. STAGING, PRODUCTION, UAT, QA"
                  value={newEnvName}
                  onChange={(e) => setNewEnvName(e.target.value)}
                  className="uppercase font-mono text-sm"
                  autoFocus
                />
              </div>
              <DialogFooter className="border-t border-border/40 pt-3">
                <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddEnvModal(false)}>
                  Cancel
                </Button>
                <Button size="sm" type="submit" disabled={!newEnvName.trim()}>
                  Create Environment
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-bold text-foreground">Global Variables</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Variables shared across test cases with environment-specific values
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAllSecrets(!showAllSecrets)}
            className="h-8 text-xs font-medium"
            title="Toggle masking for sensitive variables"
          >
            {showAllSecrets ? <EyeOff className="h-3.5 w-3.5 mr-1.5" /> : <Eye className="h-3.5 w-3.5 mr-1.5" />}
            {showAllSecrets ? 'Mask Secrets' : 'Reveal Secrets'}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setShowAddEnvModal(true)} className="h-8 text-xs font-medium">
            <Globe className="h-3.5 w-3.5 mr-1.5 text-muted-foreground" />
            + Environment
          </Button>
          <Button size="sm" onClick={handleAddVariable} className="h-8 text-xs font-medium shadow-xs">
            <Plus className="h-3.5 w-3.5 mr-1.5" />
            {activeTab === 'postman' ? 'Add Postman Variable' : 'Add Variable'}
          </Button>
        </div>
      </div>

      {/* Namespace Tabs: Standard Test Variables vs Postman / API Variables */}
      <div className="flex items-center gap-2 border-b border-border/50 pb-2.5">
        <button
          type="button"
          onClick={() => setActiveTab('global')}
          className={cn(
            'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border',
            activeTab === 'global'
              ? 'bg-primary/10 text-primary border-primary/30 shadow-2xs'
              : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-muted/40'
          )}
        >
          <Globe className="h-3.5 w-3.5" />
          <span>Test Variables (Global)</span>
          <span className="px-1.5 py-0.2 rounded-full bg-muted text-[10px] font-mono">
            {variables.length}
          </span>
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('postman')}
          className={cn(
            'inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer border',
            activeTab === 'postman'
              ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30 shadow-2xs'
              : 'text-muted-foreground hover:text-foreground border-transparent hover:bg-muted/40'
          )}
        >
          <PostmanLogo className="h-3.5 w-3.5" />
          <span>Postman / API Variables</span>
          <span className="px-1.5 py-0.2 rounded-full bg-muted text-[10px] font-mono">
            {postmanVariables.length}
          </span>
        </button>
      </div>

      {/* Search & Overview Bar */}
      <div className="flex items-center justify-between gap-3">
        <div className="relative max-w-sm flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            placeholder="Search by variable key or value..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 h-8 text-xs bg-card/60"
          />
        </div>
        <span className="text-xs text-muted-foreground font-medium">
          {filteredVariables.length} {filteredVariables.length === 1 ? 'variable' : 'variables'} · {environments.length} {environments.length === 1 ? 'environment' : 'environments'}
        </span>
      </div>

      {/* Unified Variables Matrix Table */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filteredVariables.length === 0 ? (
        <div className="bg-card/40 border border-border/60 rounded-2xl p-12 text-center shadow-xs">
          <Info className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
          <p className="text-sm font-semibold text-foreground mb-1">
            {search ? 'No matching variables found' : 'No global variables yet'}
          </p>
          <p className="text-xs text-muted-foreground mb-4">
            {search ? 'Try clearing your search query' : 'Create variables to parameterize test URLs, credentials, and OTPs'}
          </p>
          {!search && (
            <Button size="sm" onClick={handleAddVariable}>
              <Plus className="h-3.5 w-3.5 mr-1.5" />
              Add Variable
            </Button>
          )}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
          <table className="w-full text-xs text-left border-collapse table-fixed min-w-[700px]">
            <thead>
              <tr className="bg-muted/35 dark:bg-white/[0.02] text-muted-foreground border-b border-border/50 uppercase tracking-wider font-semibold text-[11px]">
                <th className="h-11 px-4 border-r border-border/30 w-[18%]">Variable Key</th>
                {environments.map((env) => (
                  <th key={env.id} className="h-11 px-3 border-r border-border/30 font-semibold text-foreground/90 truncate">
                    <span className="font-mono">{env.name}</span>
                  </th>
                ))}
                <th className="h-11 px-3 border-r border-border/30 w-[14%]">Default Fallback</th>
                <th className="h-11 px-3 border-r border-border/30 w-[16%]">Description</th>
                <th className="h-11 px-2 w-[70px] text-center border-r border-border/30">Used In</th>
                <th className="h-11 px-2 w-[60px] text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {filteredVariables.map((variable) => {
                const usageCount = variable.usage_count || 0;
                const isSecret = Boolean(variable.is_secret);

                return (
                  <tr
                    key={variable.id}
                    className="hover:bg-primary/[0.06] dark:hover:bg-white/[0.05] transition-colors group cursor-pointer"
                    onClick={() => handleEditVariable(variable)}
                  >
                    {/* Key Column: Sky Blue pill */}
                    <td className="px-4 py-2.5 border-r border-border/30 align-middle">
                      <div className="inline-flex items-center gap-1.5 max-w-full">
                        <span className="px-2 py-0.5 rounded-md bg-sky-500/10 text-sky-700 dark:text-sky-300 border border-sky-500/30 font-mono text-xs font-semibold truncate select-all">
                          {formatVariableName(variable.key)}
                        </span>
                        {isSecret && (
                          <span title="Masked secret">
                            <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                          </span>
                        )}
                      </div>
                    </td>

                    {/* Environment Value Columns (Side-by-Side Matrix) */}
                    {environments.map((env) => {
                      const envValObj = variable.values?.find((v: any) => v.environment_id === env.id);
                      const rawVal = envValObj?.value;
                      const hasVal = rawVal !== undefined && rawVal !== null && rawVal !== '';
                      const displayVal = hasVal && isSecret && !showAllSecrets ? '••••••••' : rawVal;
                      const cellKey = `${variable.id}-${env.id}`;
                      const isCopied = copiedValueKey === cellKey;

                      return (
                        <td
                          key={env.id}
                          className="px-3 py-2.5 border-r border-border/30 align-middle truncate"
                          onClick={(e) => e.stopPropagation()}
                        >
                          {hasVal ? (
                            <div className="inline-flex items-center gap-1 max-w-full group/chip">
                              <span className="font-mono text-xs bg-muted/40 px-2 py-0.5 rounded-md border border-border/40 text-foreground/90 select-all truncate">
                                {displayVal}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => handleCopyValue(cellKey, rawVal, e)}
                                className="p-1 rounded text-muted-foreground hover:text-foreground opacity-0 group-hover/chip:opacity-100 transition-opacity shrink-0 cursor-pointer"
                                title="Copy raw value"
                              >
                                {isCopied ? (
                                  <Check className="h-3 w-3 text-emerald-500" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                              </button>
                            </div>
                          ) : (
                            <span className="text-xs text-muted-foreground/40 font-mono select-none">—</span>
                          )}
                        </td>
                      );
                    })}

                    {/* Default Fallback Column */}
                    <td className="px-3 py-2.5 border-r border-border/30 text-muted-foreground align-middle truncate font-mono text-xs">
                      {variable.default_value ? (
                        <span className="truncate block" title={variable.default_value}>
                          {isSecret && !showAllSecrets ? '••••••••' : variable.default_value}
                        </span>
                      ) : (
                        <span className="text-muted-foreground/40 select-none">—</span>
                      )}
                    </td>

                    {/* Description Column */}
                    <td className="px-3 py-2.5 border-r border-border/30 text-muted-foreground align-middle truncate">
                      <span className="truncate block">{variable.description || '—'}</span>
                    </td>

                    {/* Used In Column */}
                    <td
                      className="px-2 py-2.5 text-center border-r border-border/30 align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      {usageCount > 0 ? (
                        <button
                          type="button"
                          onClick={() => handleViewUsage(variable)}
                          className="text-[11px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-500/20 font-medium transition-colors cursor-pointer"
                          title="View test cases using this variable"
                        >
                          {usageCount} case{usageCount !== 1 ? 's' : ''}
                        </button>
                      ) : (
                        <span className="text-muted-foreground/40 text-xs">—</span>
                      )}
                    </td>

                    {/* Actions Column */}
                    <td
                      className="px-2 py-2.5 text-right align-middle"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <div className="flex items-center justify-end gap-0.5">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-foreground"
                          onClick={() => handleEditVariable(variable)}
                          title="Edit variable values"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                          onClick={() => handleDeleteVariable(variable)}
                          title="Delete variable"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Variable Dialog */}
      <VariableFormDialog
        projectId={projectId}
        variable={editingVariable}
        environments={environments}
        open={showAddVarModal}
        isPostmanMode={activeTab === 'postman'}
        onSave={handleSaveVariable}
        onCancel={() => {
          setShowAddVarModal(false);
          setEditingVariable(null);
        }}
      />

      {/* Add Environment Dialog */}
      <Dialog open={showAddEnvModal} onOpenChange={setShowAddEnvModal}>
        <DialogContent className="max-w-md bg-card text-card-foreground border border-border/80 shadow-2xl">
          <DialogHeader>
            <DialogTitle className="text-base font-semibold">New Environment</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleAddEnvironment} className="space-y-4 py-2">
            <div>
              <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block mb-1">
                Environment Name
              </label>
              <Input
                placeholder="e.g. STAGING, PRODUCTION, UAT, QA"
                value={newEnvName}
                onChange={(e) => setNewEnvName(e.target.value)}
                className="uppercase font-mono text-sm"
                autoFocus
              />
            </div>
            <DialogFooter className="border-t border-border/40 pt-3">
              <Button type="button" variant="ghost" size="sm" onClick={() => setShowAddEnvModal(false)}>
                Cancel
              </Button>
              <Button size="sm" type="submit" disabled={!newEnvName.trim()}>
                Create Environment
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      {confirmConfig && (
        <ConfirmModal
          open={confirmConfig.open}
          onOpenChange={(open) => !open && setConfirmConfig(null)}
          title={confirmConfig.title}
          description={confirmConfig.description}
          confirmLabel={confirmConfig.confirmLabel}
          variant={confirmConfig.variant || 'default'}
          onConfirm={() => {
            confirmConfig.onConfirm();
            setConfirmConfig(null);
          }}
        />
      )}

      {/* Usage Slide-Over Drawer */}
      {showUsageDrawer && (
        <div className="fixed inset-0 z-50 flex">
          <div className="fixed inset-0 bg-black/60 backdrop-blur-xs" onClick={() => setShowUsageDrawer(null)} />
          <div className="relative ml-auto w-full max-w-md h-full bg-card border-l border-border/80 p-6 overflow-y-auto shadow-2xl animate-in slide-in-from-right duration-200">
            <div className="flex items-center justify-between mb-5 pb-3 border-b border-border/40">
              <div>
                <h3 className="text-base font-bold text-foreground">Variable Usage: {formatVariableName(showUsageDrawer)}</h3>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {usageCases.length} occurrence{usageCases.length === 1 ? '' : 's'} across test cases
                </p>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setShowUsageDrawer(null)}>
                <X className="h-4 w-4" />
              </Button>
            </div>

            {usageCases.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8 italic">No test cases found using this variable.</p>
            ) : (
              <div className="space-y-2">
                {usageCases.map((item, idx) => (
                  <Link
                    key={`${item.id}-${idx}`}
                    href={`/p/${slug}/repository/${item.display_id}`}
                    target="_blank"
                    className="flex items-center justify-between gap-3 p-3 rounded-xl border border-border/50 bg-muted/20 hover:bg-muted/40 hover:border-primary/40 transition-all group cursor-pointer shadow-2xs"
                  >
                    <div className="flex items-center gap-2.5 min-w-0 flex-1">
                      <span className="font-mono text-xs font-bold text-primary group-hover:underline shrink-0">
                        {item.display_id}
                      </span>
                      <span className="text-xs font-medium text-foreground group-hover:text-primary transition-colors truncate">
                        {item.title}
                      </span>
                    </div>
                    <span className={cn(
                      "text-[10px] px-2 py-0.5 rounded-full uppercase font-medium shrink-0",
                      item.status === 'ACTIVE' ? "bg-emerald-500/10 text-emerald-600" :
                      item.status === 'DRAFT' ? "bg-blue-500/10 text-blue-600" : "bg-muted text-muted-foreground"
                    )}>
                      {item.status}
                    </span>
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Variable Form Dialog matching the Matrix table 1:1
function VariableFormDialog({
  projectId,
  variable,
  environments,
  open,
  isPostmanMode = false,
  onSave,
  onCancel,
}: {
  projectId: string;
  variable: any | null;
  environments: any[];
  open: boolean;
  isPostmanMode?: boolean;
  onSave: (data: any) => void;
  onCancel: () => void;
}) {
  const [key, setKey] = useState(variable?.key || '');
  const [description, setDescription] = useState(variable?.description || '');
  const [defaultValue, setDefaultValue] = useState(variable?.default_value || variable?.defaultValue || '');
  const [isSecret, setIsSecret] = useState(Boolean(variable?.is_secret || variable?.isSecret));
  const [sameForAll, setSameForAll] = useState(true);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [uploadingTarget, setUploadingTarget] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setKey(variable?.key || '');
      setDescription(variable?.description || '');
      const initDefault = variable?.default_value || variable?.defaultValue || '';
      setDefaultValue(initDefault);
      setIsSecret(Boolean(variable?.is_secret || variable?.isSecret));
      const vals: Record<string, string> = {};
      if (variable?.values && Array.isArray(variable.values)) {
        variable.values.forEach((v: any) => {
          vals[v.environment_id] = v.value || '';
        });
      }
      const nonEmptyVals = Object.values(vals).filter((v) => v && v.trim() !== '');
      const uniqueNonEmpty = new Set(nonEmptyVals);
      // Default to "Same value for all environments" when creating or when all environments share 0/1 value
      const shouldDefaultSame =
        !variable ||
        (uniqueNonEmpty.size === 0) ||
        (uniqueNonEmpty.size === 1 && nonEmptyVals.length === environments.length);

      if (shouldDefaultSame) {
        const sharedVal = nonEmptyVals[0] || initDefault || '';
        setDefaultValue(sharedVal);
        const syncedVals: Record<string, string> = {};
        environments.forEach((env) => {
          syncedVals[env.id] = sharedVal;
        });
        setValues(syncedVals);
        setSameForAll(true);
      } else {
        setValues(vals);
        setSameForAll(false);
      }
      setError('');
    }
  }, [variable, open, environments]);

  const validateKey = (value: string) => {
    if (!value) {
      setError('Key is required');
      return false;
    }
    if (isPostmanMode) {
      if (!/^[a-zA-Z0-9_.-]+$/.test(value)) {
        setError('Key can contain letters, numbers, underscores, dots, and hyphens');
        return false;
      }
    } else if (!/^[A-Z][A-Z0-9_]*$/.test(value)) {
      setError('Key must start with a letter and contain only uppercase letters, numbers, and underscores');
      return false;
    }
    setError('');
    return true;
  };

  const handleKeyChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = isPostmanMode
      ? e.target.value.replace(/[^a-zA-Z0-9_.-]/g, '')
      : e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '');
    setKey(value);
    validateKey(value);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateKey(key)) return;
    onSave({ key, description, defaultValue, isSecret, values });
  };

  const handleSameForAllChange = (val: string) => {
    setDefaultValue(val);
    const newVals: Record<string, string> = {};
    environments.forEach((env) => {
      newVals[env.id] = val;
    });
    setValues(newVals);
  };

  const handleFileAttach = async (file: File, targetEnvId: 'all' | string) => {
    if (!file) return;
    setUploadingTarget(targetEnvId);
    try {
      const arrayBuf = await file.arrayBuffer();
      const bytes = new Uint8Array(arrayBuf);
      let binary = '';
      for (let i = 0; i < bytes.byteLength; i++) {
        binary += String.fromCharCode(bytes[i]);
      }
      const base64 = btoa(binary);
      const res = await uploadVariableAttachmentAction({
        projectId,
        filename: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileSize: file.size,
        fileBase64: base64,
      });
      if (targetEnvId === 'all') {
        handleSameForAllChange(res.valueToken);
      } else {
        setValues((prev) => ({ ...prev, [targetEnvId]: res.valueToken }));
      }
      toast.success(`Attached file "${res.filename}" to variable`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to upload variable attachment');
    } finally {
      setUploadingTarget(null);
    }
  };

  const handleCopyToAll = (val: string) => {
    if (!val) return;
    setDefaultValue((prev: string) => prev || val);
    setValues((prev) => {
      const next = { ...prev };
      environments.forEach((env) => {
        if (!next[env.id]) next[env.id] = val;
      });
      return next;
    });
    toast.success('Copied to all empty environments');
  };

  const sharedVal = defaultValue || (environments[0] ? values[environments[0].id] || '' : '');

  return (
    <Dialog open={open} onOpenChange={(isOpen) => { if (!isOpen) onCancel(); }}>
      <DialogContent className="sm:max-w-xl max-h-[88vh] !flex flex-col overflow-hidden bg-card text-card-foreground border border-border/80 shadow-2xl p-0">
        <DialogHeader className="px-5 py-3.5 border-b border-border/50 shrink-0">
          <DialogTitle className="text-base font-bold">
            {variable
              ? `Edit ${isPostmanMode ? 'Postman ' : ''}Variable`
              : `Add ${isPostmanMode ? 'Postman ' : ''}Variable`}
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="flex-1 flex flex-col min-h-0 overflow-hidden">
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-3.5">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Variable Key *
                </label>
                <Input
                  value={key}
                  onChange={handleKeyChange}
                  placeholder={
                    isPostmanMode
                      ? 'e.g. base_api_url, auth_token, mobile'
                      : 'e.g. HOMEPAGE_URL, MAGICOTP, API_TOKEN'
                  }
                  className={cn('font-mono text-xs h-8.5', error && 'border-red-500')}
                  autoFocus={!variable}
                />
                {error ? (
                  <p className="text-[11px] text-red-500 font-medium">{error}</p>
                ) : (
                  <p className="text-[10.5px] text-muted-foreground">
                    {isPostmanMode
                      ? 'Case-sensitive Postman key (letters, numbers, _, ., -).'
                      : 'Uppercase letters, numbers, and underscores.'}
                  </p>
                )}
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">
                  Description (optional)
                </label>
                <Input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="What this variable is used for"
                  className="text-xs h-8.5"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 pt-1">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-medium text-foreground select-none">
                <input
                  type="checkbox"
                  checked={isSecret}
                  onChange={(e) => setIsSecret(e.target.checked)}
                  className="rounded border-border/50 text-primary"
                />
                <span>Mask as sensitive secret (••••••••)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-primary select-none">
                <input
                  type="checkbox"
                  checked={sameForAll}
                  onChange={(e) => {
                    const checked = e.target.checked;
                    setSameForAll(checked);
                    if (checked && sharedVal) {
                      handleSameForAllChange(sharedVal);
                    }
                  }}
                  className="rounded border-border/50 text-primary"
                />
                <span>Same value for all environments</span>
              </label>
            </div>

            <div className="space-y-2.5 pt-2.5 border-t border-border/40">
              {sameForAll ? (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-foreground">
                      Value (Applied to all {environments.length} environments &amp; default fallback)
                    </label>
                    <label className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline cursor-pointer">
                      <Paperclip className="h-3 w-3" />
                      <span>{uploadingTarget === 'all' ? 'Uploading...' : 'Attach File'}</span>
                      <input
                        type="file"
                        className="hidden"
                        disabled={uploadingTarget !== null}
                        onChange={(e) => {
                          const f = e.target.files?.[0];
                          if (f) handleFileAttach(f, 'all');
                          e.target.value = '';
                        }}
                      />
                    </label>
                  </div>
                  <Input
                    value={sharedVal}
                    onChange={(e) => handleSameForAllChange(e.target.value)}
                    placeholder="Enter value or attach a file (e.g. https://uat-api.inkasure.com)"
                    className="font-mono text-xs h-9"
                  />
                  {sharedVal.startsWith('attachment://') && (
                    <div className="text-[11px] font-mono text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
                      <Paperclip className="h-3 w-3" />
                      <span>Attached file: {sharedVal.split('/').slice(3).join('/')}</span>
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      Values by Environment ({environments.length})
                    </label>
                    <span className="text-[10.5px] text-muted-foreground">
                      Click <Copy className="h-3 w-3 inline mx-0.5" /> to fill empty environments or{' '}
                      <Paperclip className="h-3 w-3 inline mx-0.5" /> to attach a file
                    </span>
                  </div>

                  {/* Compact 2-Column Grid so many environments never blow up modal height */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 max-h-52 overflow-y-auto pr-1">
                    {environments.map((env) => {
                      const val = values[env.id] || '';
                      return (
                        <div
                          key={env.id}
                          className="p-2 rounded-lg border border-border/60 bg-muted/15 space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-bold text-foreground font-mono uppercase">
                              {env.name}
                            </span>
                            <div className="flex items-center gap-1">
                              <label
                                title={`Attach file for ${env.name}`}
                                className="p-1 text-muted-foreground hover:text-primary rounded cursor-pointer"
                              >
                                <Paperclip className="h-3 w-3" />
                                <input
                                  type="file"
                                  className="hidden"
                                  disabled={uploadingTarget !== null}
                                  onChange={(e) => {
                                    const f = e.target.files?.[0];
                                    if (f) handleFileAttach(f, env.id);
                                    e.target.value = '';
                                  }}
                                />
                              </label>
                              <button
                                type="button"
                                onClick={() => handleCopyToAll(val)}
                                title="Copy to all empty environments"
                                className="p-1 text-muted-foreground hover:text-foreground rounded cursor-pointer"
                              >
                                <Copy className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <Input
                            value={val}
                            onChange={(e) => setValues({ ...values, [env.id]: e.target.value })}
                            placeholder={`${env.name} value`}
                            className="font-mono text-xs h-8 bg-background"
                          />
                        </div>
                      );
                    })}
                  </div>

                  <div className="space-y-1 pt-1">
                    <label className="text-[11px] font-semibold text-muted-foreground block">
                      Default Fallback (used if an environment above is left blank)
                    </label>
                    <Input
                      value={defaultValue}
                      onChange={(e) => setDefaultValue(e.target.value)}
                      placeholder="Optional fallback value"
                      className="font-mono text-xs h-8"
                    />
                  </div>
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="px-5 py-3 border-t border-border/50 bg-muted/15 flex gap-2 shrink-0">
            <Button type="button" variant="ghost" size="sm" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              {variable ? 'Update Variable' : 'Create Variable'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}