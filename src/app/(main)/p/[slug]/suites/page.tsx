"use client";

import { useParams, useRouter } from 'next/navigation';
import { useState, useMemo, useEffect } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { DataTable } from '@/components/common/DataTable';
import { SuiteTypeBadge } from '@/components/common/SuiteTypeBadge';
import { EmptyState } from '@/components/common/EmptyState';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { UserAvatar } from '@/components/common/UserAvatar';
import { ProgressCircle } from '@/components/common/ProgressCircle';
import { Tooltip } from '@/components/ui/tooltip';
import { Layers, Plus, X, Edit2, Trash2, Search, Play, MoreVertical, RotateCcw } from 'lucide-react';
import { RunStatusBadge } from '@/components/common/RunStatusBadge';
import { CreateRunModal } from '@/components/runs/CreateRunModal';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Select } from '@/components/ui/select';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import type { SuiteType } from '@/lib/types';
import {
  createTestSuiteAction,
  archiveTestSuiteAction,
  restoreTestSuiteAction,
  bulkArchiveSuitesAction,
  updateTestSuiteAction,
  getArchivedSuitesAction,
  deleteTestSuiteAction,
} from '@/app/actions/suites';

export default function SuitesPage() {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const router = useRouter();

  const { project, suites, setSuites, runs, members, canEdit = true, isAdmin = false } = useProjectData();

  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [newSuiteType, setNewSuiteType] = useState<SuiteType>('smoke');
  const [customType, setCustomType] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showArchived, setShowArchived] = useState(false);
  const [archivedSuites, setArchivedSuites] = useState<any[]>([]);
  const [archivedLoading, setArchivedLoading] = useState(false);
  const [selectedSuiteIds, setSelectedSuiteIds] = useState<Set<string>>(new Set());
  const [showBulkArchiveConfirm, setShowBulkArchiveConfirm] = useState(false);
  const [singleArchiveSuite, setSingleArchiveSuite] = useState<any | null>(null);
  const [singleDeleteSuite, setSingleDeleteSuite] = useState<any | null>(null);
  const [editModalSuite, setEditModalSuite] = useState<any | null>(null);
  const [editModalName, setEditModalName] = useState('');
  const [editModalType, setEditModalType] = useState<SuiteType>('smoke');
  const [editModalCustomType, setEditModalCustomType] = useState('');
  const [isUpdatingSuite, setIsUpdatingSuite] = useState(false);
  const [editingSuiteId, setEditingSuiteId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [openRowMenuId, setOpenRowMenuId] = useState<string | null>(null);
  const [runModalSuiteId, setRunModalSuiteId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState('');

  useEffect(() => {
    if (project?.id) {
      getArchivedSuitesAction(project.id)
        .then((data) => setArchivedSuites(data || []))
        .catch(() => {});
    }
  }, [project?.id]);

  const typeOptions = useMemo(() => {
    const types = new Set<string>(['smoke', 'regression', 'sprint', 'custom']);
    for (const s of suites) {
      if (s.type) types.add(String(s.type).toLowerCase());
    }
    return [
      { value: '', label: 'All Types' },
      ...Array.from(types).map((t) => ({
        value: t,
        label: t.charAt(0).toUpperCase() + t.slice(1),
      })),
    ];
  }, [suites]);

  const filteredSuites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return suites.filter((s: any) => {
      if (typeFilter && String(s.type || '').toLowerCase() !== typeFilter) return false;
      if (q) {
        const matchName = s.name?.toLowerCase().includes(q);
        const matchId = s.id?.toLowerCase().includes(q);
        const matchType = s.type?.toLowerCase().includes(q);
        if (!matchName && !matchId && !matchType) return false;
      }
      return true;
    });
  }, [suites, searchQuery, typeFilter]);

  const filteredArchivedSuites = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return archivedSuites.filter((s: any) => {
      if (typeFilter && String(s.type || '').toLowerCase() !== typeFilter) return false;
      if (q) {
        const matchName = s.name?.toLowerCase().includes(q);
        const matchId = s.id?.toLowerCase().includes(q);
        if (!matchName && !matchId) return false;
      }
      return true;
    });
  }, [archivedSuites, searchQuery, typeFilter]);

  if (!project) return null;

  const handleToggleArchived = async (archived: boolean) => {
    setShowArchived(archived);
    setSelectedSuiteIds(new Set());
    if (archived && archivedSuites.length === 0 && project?.id) {
      setArchivedLoading(true);
      try {
        const data = await getArchivedSuitesAction(project.id);
        setArchivedSuites(data || []);
      } catch (e: any) {
        toast.error(e.message || 'Failed to load archived suites');
      } finally {
        setArchivedLoading(false);
      }
    }
  };

  const handleRenameSuite = async (suiteId: string) => {
    if (!editingName.trim()) return;
    try {
      const updated = await updateTestSuiteAction(suiteId, { name: editingName.trim() });
      setSuites(suites.map((s: any) => (s.id === suiteId ? { ...s, name: updated.name } : s)));
      toast.success('Suite renamed');
      setEditingSuiteId(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to rename suite');
    }
  };

  const handleCreateSuite = async () => {
    if (!newSuiteName.trim()) return;
    setIsSubmitting(true);
    try {
      const finalType = newSuiteType === 'custom' ? (customType.trim() || 'custom') : newSuiteType;
      const suite = await createTestSuiteAction({
        projectId: project.id,
        name: newSuiteName,
        type: finalType,
      });

      const mappedSuite = {
        id: suite.id,
        projectId: suite.project_id,
        name: suite.name,
        type: (suite.tags[0] || 'smoke').toLowerCase(),
        environment: suite.environment,
        createdBy: suite.created_by,
        createdAt: suite.created_at.toISOString(),
        caseCount: 0,
      };

      setSuites([mappedSuite, ...suites]);
      toast.success('Suite created');
      setShowCreateModal(false);
      setNewSuiteName('');
      setCustomType('');
    } catch (err: any) {
      toast.error(err.message || 'Failed to create suite');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleRestoreSuite = async (suiteId: string) => {
    try {
      await restoreTestSuiteAction(suiteId);
      const suite = archivedSuites.find((s: any) => s.id === suiteId);
      if (suite) setSuites([suite, ...suites]);
      setArchivedSuites(archivedSuites.filter((s: any) => s.id !== suiteId));
      toast.success('Suite restored');
    } catch (e: any) {
      toast.error(e.message || 'Failed to restore');
    }
  };

  const handleSingleArchiveConfirm = async () => {
    if (!singleArchiveSuite) return;
    try {
      await archiveTestSuiteAction(singleArchiveSuite.id);
      setArchivedSuites([singleArchiveSuite, ...archivedSuites]);
      setSuites(suites.filter((s: any) => s.id !== singleArchiveSuite.id));
      selectedSuiteIds.delete(singleArchiveSuite.id);
      setSelectedSuiteIds(new Set(selectedSuiteIds));
      toast.success('Suite deleted');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete suite');
    } finally {
      setSingleArchiveSuite(null);
    }
  };

  const handleOpenEditModal = (suite: any) => {
    setEditModalSuite(suite);
    setEditModalName(suite.name || '');
    const t = String(suite.type || 'smoke').toLowerCase();
    if (t === 'smoke' || t === 'regression' || t === 'sprint') {
      setEditModalType(t as SuiteType);
      setEditModalCustomType('');
    } else {
      setEditModalType('custom');
      setEditModalCustomType(t === 'custom' ? '' : suite.type);
    }
  };

  const handleSaveEditModal = async () => {
    if (!editModalSuite || !editModalName.trim()) return;
    setIsUpdatingSuite(true);
    try {
      const finalType =
        editModalType === 'custom' ? editModalCustomType.trim() || 'custom' : editModalType;
      const updated = await updateTestSuiteAction(editModalSuite.id, {
        name: editModalName.trim(),
        type: finalType,
      });
      setSuites(
        suites.map((s: any) =>
          s.id === editModalSuite.id
            ? { ...s, name: updated.name, type: finalType.toLowerCase() }
            : s
        )
      );
      toast.success('Suite updated');
      setEditModalSuite(null);
    } catch (err: any) {
      toast.error(err.message || 'Failed to update suite');
    } finally {
      setIsUpdatingSuite(false);
    }
  };

  const handleSingleDeleteConfirm = async () => {
    if (!singleDeleteSuite) return;
    try {
      await deleteTestSuiteAction(singleDeleteSuite.id);
      setSuites(suites.filter((s: any) => s.id !== singleDeleteSuite.id));
      setArchivedSuites(archivedSuites.filter((s: any) => s.id !== singleDeleteSuite.id));
      selectedSuiteIds.delete(singleDeleteSuite.id);
      setSelectedSuiteIds(new Set(selectedSuiteIds));
      toast.success('Suite deleted');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete suite');
    } finally {
      setSingleDeleteSuite(null);
    }
  };

  const handleBulkArchive = () => {
    if (selectedSuiteIds.size === 0) return;
    setShowBulkArchiveConfirm(true);
  };

  const confirmBulkArchive = async () => {
    try {
      const ids = Array.from(selectedSuiteIds);
      await bulkArchiveSuitesAction(ids);
      const archived = suites.filter((s: any) => selectedSuiteIds.has(s.id));
      setArchivedSuites([...archived, ...archivedSuites]);
      setSuites(suites.filter((s: any) => !selectedSuiteIds.has(s.id)));
      setSelectedSuiteIds(new Set());
      toast.success('Selected suites deleted');
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete suites');
    } finally {
      setShowBulkArchiveConfirm(false);
    }
  };

  const columns = [
    {
      id: 'name',
      header: 'Suite',
      sortable: true,
      sortValue: (row: any) => String(row.name || '').toLowerCase(),
      className: 'flex-1 min-w-[220px] text-left pr-4',
      accessor: (row: any) => {
        if (editingSuiteId === row.id) {
          return (
            <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
              <Input
                value={editingName}
                onChange={(e) => setEditingName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleRenameSuite(row.id);
                  if (e.key === 'Escape') setEditingSuiteId(null);
                }}
                className="h-7 text-xs bg-background"
                autoFocus
              />
              <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => handleRenameSuite(row.id)}>
                Save
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 px-2 text-xs text-muted-foreground"
                onClick={() => setEditingSuiteId(null)}
              >
                Cancel
              </Button>
            </div>
          );
        }
        return (
          <div className="flex items-center gap-2 group min-w-0">
            <span
              className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors cursor-pointer truncate"
              onClick={() => router.push(`/p/${slug}/suites/${row.id}`)}
              title={row.name}
            >
              {row.name}
            </span>
            {canEdit && (
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 p-1 text-muted-foreground hover:text-foreground transition-opacity shrink-0 cursor-pointer"
                onClick={(e) => {
                  e.stopPropagation();
                  setEditingSuiteId(row.id);
                  setEditingName(row.name);
                }}
                title="Rename suite"
              >
                <Edit2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        );
      },
    },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      sortValue: (row: any) => String(row.type || '').toLowerCase(),
      className: 'w-28 shrink-0 text-left',
      accessor: (row: any) => <SuiteTypeBadge type={row.type} />,
    },
    {
      id: 'cases',
      header: 'Cases',
      sortable: true,
      sortValue: (row: any) => Number(row.caseCount || 0),
      className: 'w-20 shrink-0 text-left',
      accessor: (row: any) => (
        <span className="font-mono text-xs text-foreground/90">{row.caseCount || 0}</span>
      ),
    },
    {
      id: 'lastRun',
      header: 'Last Run',
      className: 'w-44 shrink-0 text-left',
      accessor: (row: any) => {
        const suiteRuns = runs.filter((r: any) => {
          if (r.suiteId === row.id || r.suite_id === row.id) return true;
          if (r.suiteName && row.name && r.suiteName.toLowerCase() === row.name.toLowerCase()) return true;
          return false;
        });

        if (suiteRuns.length === 0) {
          return <span className="text-xs text-muted-foreground/50 italic">Never run</span>;
        }

        const sorted = [...suiteRuns].sort(
          (a: any, b: any) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
        );
        const lastRun = sorted[0];
        const lastRunDate = lastRun.startedAt || lastRun.createdAt;

        const rawResults = lastRun.results || [];
        const sortedResults = [...rawResults].sort(
          (a: any, b: any) => (b.attempt_number || 1) - (a.attempt_number || 1)
        );
        const seen = new Set<string>();
        const results = sortedResults.filter((r: any) => {
          const tcId = r.testCaseId || r.test_case_id;
          if (!tcId || seen.has(tcId)) return false;
          seen.add(tcId);
          return true;
        });

        const totalCount = results.length;
        const passCount = results.filter((r: any) => String(r.status).toLowerCase() === 'pass').length;
        const failCount = results.filter((r: any) => String(r.status).toLowerCase() === 'fail').length;
        const blockedCount = results.filter((r: any) => String(r.status).toLowerCase() === 'blocked').length;
        const skipCount = results.filter((r: any) => String(r.status).toLowerCase() === 'skip').length;
        const invalidCount = results.filter((r: any) => String(r.status).toLowerCase() === 'invalid').length;

        return (
          <div
            className="inline-flex items-center gap-2.5 group/run cursor-pointer"
            onClick={(e) => {
              e.stopPropagation();
              router.push(`/p/${slug}/runs/${lastRun.id}`);
            }}
            title={`Open run: ${lastRun.name} (#${lastRun.id})`}
          >
            {totalCount > 0 && (
              <ProgressCircle
                segments={{
                  pass: passCount,
                  fail: failCount,
                  blocked: blockedCount,
                  invalid: invalidCount,
                  skip: skipCount,
                  total: totalCount,
                }}
                size={24}
                strokeWidth={3}
              />
            )}
            <div className="flex flex-col gap-0.5 min-w-0">
              <div className="flex items-center gap-2">
                <RunStatusBadge status={lastRun.status} />
                {totalCount > 0 && (
                  <span className="text-xs font-mono font-semibold text-foreground/90 group-hover/run:text-primary transition-colors">
                    {passCount}/{totalCount}
                  </span>
                )}
              </div>
              <span className="text-[11px] text-muted-foreground font-mono whitespace-nowrap">
                {new Date(lastRunDate).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </span>
            </div>
          </div>
        );
      },
    },
    {
      id: 'createdAt',
      header: 'Date',
      sortable: true,
      sortValue: (row: any) => (row.createdAt ? new Date(row.createdAt).getTime() : 0),
      className: 'w-28 shrink-0 text-left',
      accessor: (row: any) => {
        if (!row.createdAt) return <span className="text-xs text-muted-foreground/40 font-mono">—</span>;
        return (
          <span className="text-xs font-mono text-muted-foreground whitespace-nowrap">
            {new Date(row.createdAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
          </span>
        );
      },
    },
    {
      id: 'createdBy',
      header: 'Author',
      className: 'w-14 shrink-0 text-center',
      accessor: (row: any) => {
        const member = members?.find((m: any) => m.userId === row.createdBy);
        const name = member?.user?.name || (row.createdBy ? `User #${row.createdBy}` : 'Unknown');

        return (
          <Tooltip content={name} side="top">
            <div className="flex items-center justify-center">
              {member ? (
                <UserAvatar
                  name={member.user.name}
                  imageUrl={member.user.avatarUrl}
                  size="sm"
                  className="h-6 w-6 text-[10px] shrink-0 mx-auto"
                />
              ) : (
                <div className="w-6 h-6 rounded-full bg-muted border border-border/60 flex items-center justify-center text-[10px] text-muted-foreground shrink-0 mx-auto">
                  U
                </div>
              )}
            </div>
          </Tooltip>
        );
      },
    },
    {
      id: 'action',
      header: '',
      className: 'w-10 shrink-0 text-center',
      accessor: (row: any) => {
        if (!canEdit) return null;
        return (
          <div className="flex items-center justify-center" onClick={(e) => e.stopPropagation()}>
            <Tooltip content="Run Suite" side="top">
              <button
                type="button"
                onClick={() => setRunModalSuiteId(row.id)}
                className="w-8 h-8 rounded-lg border border-border/70 bg-muted/30 hover:bg-primary/10 hover:border-primary/40 hover:text-primary text-foreground/80 flex items-center justify-center transition-all cursor-pointer shadow-xs"
              >
                <Play className="h-3.5 w-3.5" />
              </button>
            </Tooltip>
          </div>
        );
      },
    },
    {
      id: 'menu',
      header: '',
      className: 'w-8 shrink-0 text-center',
      accessor: (row: any, idx: number) => {
        if (!canEdit) return null;
        return (
          <div className="flex items-center justify-center relative" onClick={(e) => e.stopPropagation()}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setOpenRowMenuId(openRowMenuId === row.id ? null : row.id);
              }}
              className="p-1 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="More actions"
            >
              <MoreVertical className="h-4 w-4" />
            </button>

            {openRowMenuId === row.id && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={(e) => {
                    e.stopPropagation();
                    setOpenRowMenuId(null);
                  }}
                />
                <div
                  className={cn(
                    'absolute right-0 z-50 w-40 rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl p-1 text-xs space-y-0.5 animate-in fade-in-0 duration-100',
                    idx >= 4 && filteredSuites.length > 5
                      ? 'bottom-full mb-1 origin-bottom-right'
                      : 'top-full mt-1 origin-top-right'
                  )}
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRowMenuId(null);
                      handleOpenEditModal(row);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-muted flex items-center gap-2 text-foreground/90 hover:text-foreground cursor-pointer"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setOpenRowMenuId(null);
                      setSingleArchiveSuite(row);
                    }}
                    className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    <span>Delete</span>
                  </button>
                  {isAdmin && (
                    <>
                      <div className="border-t border-border/60 my-1" />
                      <button
                        type="button"
                        onClick={() => {
                          setOpenRowMenuId(null);
                          setSingleDeleteSuite(row);
                        }}
                        className="w-full text-left px-3 py-1.5 rounded-lg hover:bg-rose-500/10 text-rose-500 flex items-center gap-2 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Delete Permanently</span>
                      </button>
                    </>
                  )}
                </div>
              </>
            )}
          </div>
        );
      },
    },
  ];

  const archivedColumns = [
    {
      id: 'name',
      header: 'Suite',
      sortable: true,
      sortValue: (row: any) => String(row.name || '').toLowerCase(),
      className: 'min-w-[280px] flex-1',
      accessor: (row: any) => (
        <span className="font-semibold text-sm text-foreground group-hover:text-primary transition-colors cursor-pointer">
          {row.name}
        </span>
      ),
    },
    {
      id: 'type',
      header: 'Type',
      sortable: true,
      sortValue: (row: any) => String(row.type || '').toLowerCase(),
      className: 'w-28 shrink-0 text-left',
      accessor: (row: any) => <SuiteTypeBadge type={row.type} />,
    },
    {
      id: 'cases',
      header: 'Cases',
      sortable: true,
      sortValue: (row: any) => Number(row.caseCount || 0),
      className: 'w-20 shrink-0 text-left',
      accessor: (row: any) => <span className="font-mono text-xs text-foreground/90">{row.caseCount || 0}</span>,
    },
    {
      id: 'actions',
      header: '',
      className: 'w-24 shrink-0 text-right',
      accessor: (row: any) => (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-emerald-500 hover:text-emerald-400 hover:bg-emerald-500/10"
          onClick={(e) => {
            e.stopPropagation();
            handleRestoreSuite(row.id);
          }}
        >
          <RotateCcw className="h-3 w-3 mr-1" />
          Restore
        </Button>
      ),
    },
  ];

  return (
    <div className="p-4 sm:p-6 space-y-3.5">
      {/* Row 1: Title, Active/Archived Tabs & New Suite Button */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <h1 className="text-2xl font-bold tracking-tight">Test Suites</h1>
          <div className="inline-flex items-center rounded-xl border border-border/60 bg-muted/20 p-1 text-xs font-medium">
            <button
              type="button"
              onClick={() => handleToggleArchived(false)}
              className={cn(
                'px-3 py-1 rounded-lg transition-colors cursor-pointer',
                !showArchived
                  ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Active ({suites.length})
            </button>
            <button
              type="button"
              onClick={() => handleToggleArchived(true)}
              className={cn(
                'px-3 py-1 rounded-lg transition-colors cursor-pointer',
                showArchived
                  ? 'bg-primary/15 text-primary font-semibold shadow-xs'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              Archived ({archivedSuites.length})
            </button>
          </div>
        </div>

        {canEdit && (
          <Button
            onClick={() => setShowCreateModal(true)}
            className="gradient-btn text-white h-9 text-xs font-semibold px-4 rounded-xl shadow-sm shrink-0"
          >
            <Plus className="h-4 w-4 mr-1.5" />
            New Suite
          </Button>
        )}
      </div>

      {/* Row 2: Search, Type Filter & Bulk Actions */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-2 flex-1 min-w-[240px] max-w-lg">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Search suites by name..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-8 pl-8 pr-7 text-xs bg-background"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          <Select
            value={typeFilter}
            onValueChange={setTypeFilter}
            options={typeOptions}
            className="w-36 h-8 text-xs"
          />
        </div>

        {selectedSuiteIds.size > 0 && !showArchived && (
          <div className="flex items-center gap-2 px-3 py-1 rounded-lg border bg-muted/40 animate-in fade-in-0 duration-150">
            <span className="text-xs font-medium">{selectedSuiteIds.size} selected</span>
            <div className="h-3.5 w-px bg-border" />
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs px-2 text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 border-rose-500/20"
              onClick={handleBulkArchive}
            >
              <Trash2 className="h-3 w-3 mr-1" />
              Delete
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 text-xs px-2"
              onClick={() => setSelectedSuiteIds(new Set())}
            >
              <X className="h-3 w-3 mr-1" />
              Clear
            </Button>
          </div>
        )}
      </div>

      <div className="overflow-x-auto rounded-xl border border-border/50 bg-card/20 shadow-xs">
        {showArchived ? (
          <DataTable
            data={filteredArchivedSuites}
            columns={archivedColumns}
            loading={archivedLoading}
            onRowClick={(row) => router.push(`/p/${slug}/suites/${row.id}`)}
            getId={(row) => row.id}
            tableClassName="min-w-[720px] w-full"
            emptyComponent={
              <EmptyState
                icon={Layers}
                heading={searchQuery || typeFilter ? 'No matching archived suites' : 'No archived suites'}
                subtext={
                  searchQuery || typeFilter
                    ? 'Try adjusting your search or filter criteria'
                    : 'Archived suites will appear here'
                }
              />
            }
          />
        ) : (
          <DataTable
            data={filteredSuites}
            columns={columns}
            onRowClick={(row) => router.push(`/p/${slug}/suites/${row.id}`)}
            getId={(row) => row.id}
            selectable={canEdit}
            selectedIds={selectedSuiteIds}
            onSelectionChange={setSelectedSuiteIds}
            tableClassName="w-full min-w-[700px]"
            emptyComponent={
              <EmptyState
                icon={Layers}
                heading={searchQuery || typeFilter ? 'No matching test suites' : 'No test suites'}
                subtext={
                  searchQuery || typeFilter
                    ? 'Try adjusting your search or filter criteria'
                    : canEdit
                    ? 'Create your first test suite'
                    : 'No test suites have been created yet'
                }
                action={
                  canEdit && !searchQuery && !typeFilter
                    ? {
                        label: 'New Suite',
                        onClick: () => setShowCreateModal(true),
                      }
                    : undefined
                }
              />
            }
          />
        )}
      </div>

      <Dialog open={showCreateModal} onOpenChange={setShowCreateModal}>
        <DialogContent onClose={() => setShowCreateModal(false)}>
          <DialogHeader>
            <DialogTitle>Create Test Suite</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={newSuiteName}
                onChange={(e) => setNewSuiteName(e.target.value)}
                placeholder="Suite name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select
                value={newSuiteType}
                onValueChange={(val) => setNewSuiteType(val as SuiteType)}
                options={[
                  { value: 'smoke', label: 'Smoke' },
                  { value: 'regression', label: 'Regression' },
                  { value: 'sprint', label: 'Sprint' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>
            {newSuiteType === 'custom' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Custom Type Name</label>
                <Input
                  value={customType}
                  onChange={(e) => setCustomType(e.target.value)}
                  placeholder="e.g. End-To-End, Sanity, Integration"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateModal(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateSuite} disabled={isSubmitting} className="gradient-btn text-white">
              {isSubmitting ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={editModalSuite !== null} onOpenChange={(open) => { if (!open) setEditModalSuite(null); }}>
        <DialogContent onClose={() => setEditModalSuite(null)}>
          <DialogHeader>
            <DialogTitle>Edit Test Suite</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Name</label>
              <Input
                value={editModalName}
                onChange={(e) => setEditModalName(e.target.value)}
                placeholder="Suite name"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium">Type</label>
              <Select
                value={editModalType}
                onValueChange={(val) => setEditModalType(val as SuiteType)}
                options={[
                  { value: 'smoke', label: 'Smoke' },
                  { value: 'regression', label: 'Regression' },
                  { value: 'sprint', label: 'Sprint' },
                  { value: 'custom', label: 'Custom' },
                ]}
              />
            </div>
            {editModalType === 'custom' && (
              <div className="space-y-2">
                <label className="text-sm font-medium">Custom Type Name</label>
                <Input
                  value={editModalCustomType}
                  onChange={(e) => setEditModalCustomType(e.target.value)}
                  placeholder="e.g. End-To-End, Sanity, Integration"
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModalSuite(null)}>
              Cancel
            </Button>
            <Button onClick={handleSaveEditModal} disabled={isUpdatingSuite} className="gradient-btn text-white">
              {isUpdatingSuite ? 'Saving...' : 'Save Changes'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={singleArchiveSuite !== null}
        onOpenChange={(open) => {
          if (!open) setSingleArchiveSuite(null);
        }}
        title="Delete Test Suite"
        description={`Are you sure you want to delete "${singleArchiveSuite?.name}"? It will be removed from your active suites. Test cases and execution history are preserved.`}
        confirmLabel="Delete Suite"
        variant="destructive"
        requireTypedConfirmation="DELETE"
        onConfirm={handleSingleArchiveConfirm}
      />

      <ConfirmModal
        open={singleDeleteSuite !== null}
        onOpenChange={(open) => {
          if (!open) setSingleDeleteSuite(null);
        }}
        title="Delete Test Suite"
        description={`Are you sure you want to permanently delete "${singleDeleteSuite?.name}"? Its test cases will remain in the repository, but this suite cannot be recovered. This action cannot be undone.`}
        confirmLabel="Delete Suite"
        variant="destructive"
        requireTypedConfirmation="DELETE"
        onConfirm={handleSingleDeleteConfirm}
      />

      <ConfirmModal
        open={showBulkArchiveConfirm}
        onOpenChange={setShowBulkArchiveConfirm}
        title="Delete Selected Test Suites"
        description={`Are you sure you want to delete ${selectedSuiteIds.size} selected suite(s)? They will be removed from your active suites. Test cases and execution history are preserved.`}
        confirmLabel="Delete Suites"
        variant="destructive"
        requireTypedConfirmation="DELETE"
        onConfirm={confirmBulkArchive}
      />

      <CreateRunModal
        open={runModalSuiteId !== null}
        onOpenChange={(open) => {
          if (!open) setRunModalSuiteId(null);
        }}
        slug={slug}
        initialSuiteId={runModalSuiteId}
      />
    </div>
  );
}
