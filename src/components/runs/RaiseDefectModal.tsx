"use client";

import React, { useState, useEffect, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Bug, Sparkles, X, Film, Image as ImageIcon, Loader2, Paperclip, FileSpreadsheet, FileText, AlertTriangle, ExternalLink, Check, Plus, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import {
  generateDefectReportAction,
  checkDuplicateDefectsAction,
  getProjectAiConfigAction,
  type DuplicateDefectCandidate,
} from '@/app/actions/ai';
import type { DefectEvidencePart } from '@/lib/ai/client';
import { raiseDefectAction } from '@/app/actions/runs';
import { uploadFileAction } from '@/app/actions/attachments';
import {
  getPmSpacesAction,
  getProjectConnectionsAction,
} from '@/app/actions/integrations';
import { PmSpace, PmPriority } from '@/lib/integrations/pm-client';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger.client';

export interface EvidenceAttachmentItem {
  id: string;
  filename: string;
  url?: string;
  key?: string;
  sizeBytes?: number;
  source?: string;
}

interface RaiseDefectModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  runResult: any;
  currentCase: any;
  allSteps?: any[];
  stepOrder?: number;
  stepInstruction?: string;
  stepExpectedResult?: string;
  stepNote?: string;
  initialEvidenceAttachments?: EvidenceAttachmentItem[];
  failureNotes?: string;
  buildVersion?: string;
  projectId: string;
  modules?: any[];
  currentUser: any;
  iterationIndex?: number;
  totalIterations?: number;
  iterationParameters?: Record<string, any>;
  resolvedEnvironmentUrl?: string;
  onAppendStepNote?: (stepOrder: number | undefined, text: string) => void;
  onSuccess: (defect: any) => void;
}

function formatCleanDefaultTitle(caseTitle?: string): string {
  if (!caseTitle) return 'Execution failure';
  const cleaned = caseTitle.replace(/^(Verify|Check|Validate|Test)\s+/i, '');
  return `Issue with ${cleaned}`;
}

function formatCleanDefaultDescription(
  caseTitle?: string,
  preConditions?: string,
  stepOrder?: number,
  stepInstruction?: string,
  stepExpected?: string,
  allSteps?: any[],
  notes?: string,
  stepNote?: string,
  environment?: string,
  buildVersion?: string,
  iterationIndex?: number,
  totalIterations?: number,
  iterationParameters?: Record<string, any>,
  resolvedEnvironmentUrl?: string
): string {
  let stepsText = '';
  if (stepInstruction) {
    if (/\d+\.\s+/.test(stepInstruction)) {
      const parts = stepInstruction.split(/(?=\d+\.\s+)/).map((s) => s.trim()).filter(Boolean);
      stepsText = parts.join('\n');
    } else {
      stepsText = `1. Execute step ${stepOrder || 1}: ${stepInstruction}`;
    }
  } else if (allSteps && allSteps.length > 0) {
    stepsText = allSteps
      .map((s, idx) => {
        const exp = s.expected_result || s.expectedResult;
        return `${idx + 1}. ${s.step}${exp ? ` (Expected: ${exp})` : ''}`;
      })
      .join('\n');
  } else {
    stepsText = `1. Execute test case "${caseTitle || ''}"`;
  }

  let desc = '';
  if (preConditions) {
    const cleanPre = preConditions.replace(/^my:\s*/i, '').trim();
    if (cleanPre) {
      desc += `### Preconditions\n- ${cleanPre}\n\n`;
    }
  }

  const combinedActual = [stepNote?.trim(), notes?.trim()]
    .filter((v, idx, arr) => Boolean(v) && arr.indexOf(v) === idx)
    .join(' — ');

  desc += `### Steps to Reproduce\n${stepsText}\n\n`;
  desc += `### Expected Result\n- ${stepExpected || 'All steps execute successfully and produce the expected outcome.'}\n\n`;
  desc += `### Actual Result\n- ${combinedActual || 'Execution encountered failure during test execution.'}\n\n`;
  desc += `### Environment & Test Data\n- **Environment:** ${environment || 'Staging'}${resolvedEnvironmentUrl ? ` (${resolvedEnvironmentUrl})` : ''}\n`;
  if (buildVersion) {
    desc += `- **Build:** ${buildVersion}\n`;
  }
  if (iterationIndex) {
    desc += `- **Iteration:** #${iterationIndex}${totalIterations ? ` of ${totalIterations}` : ''}\n`;
  }
  if (iterationParameters && Object.keys(iterationParameters).length > 0) {
    desc += `- **Active Parameters:**\n` + Object.entries(iterationParameters).map(([k, v]) => `  - \`${k}\`: "${v}"`).join('\n') + '\n';
  }

  return desc;
}

export function RaiseDefectModal({
  open,
  onOpenChange,
  runResult,
  currentCase,
  allSteps = [],
  stepOrder,
  stepInstruction,
  stepExpectedResult,
  stepNote,
  initialEvidenceAttachments = [],
  failureNotes,
  buildVersion,
  projectId,
  currentUser,
  iterationIndex,
  totalIterations,
  iterationParameters,
  resolvedEnvironmentUrl,
  onAppendStepNote,
  onSuccess,
}: RaiseDefectModalProps) {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedSeverity, setSelectedSeverity] = useState<'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW'>('MEDIUM');
  const [selectedPriorityId, setSelectedPriorityId] = useState<string>('');
  const [selectedSpaceId, setSelectedSpaceId] = useState<string>('');
  const [ticketUrl, setTicketUrl] = useState('');
  const [createInPmTool, setCreateInPmTool] = useState(true);
  const [isPmConfigured, setIsPmConfigured] = useState(false);

  // AI & Deduplication state
  const [aiDraftEnabled, setAiDraftEnabled] = useState(true);
  const [aiVisionEnabled, setAiVisionEnabled] = useState(true);
  const [includeEvidenceInAi, setIncludeEvidenceInAi] = useState(true);
  const [extractedObservation, setExtractedObservation] = useState('');
  const [observationAppended, setObservationAppended] = useState(false);
  const [duplicateCandidates, setDuplicateCandidates] = useState<DuplicateDefectCandidate[]>([]);
  const [showCustomAiPrompt, setShowCustomAiPrompt] = useState(false);
  const [customAiPrompt, setCustomAiPrompt] = useState('');

  // Spaces & Priorities from PM Tool
  const [spaces, setSpaces] = useState<PmSpace[]>([]);
  const [priorities, setPriorities] = useState<PmPriority[]>([]);
  const [loadingSpaces, setLoadingSpaces] = useState(false);

  // Pre-attached Evidence & Newly Uploaded Files
  const [existingEvidence, setExistingEvidence] = useState<EvidenceAttachmentItem[]>([]);
  interface AttachedFileItem {
    id: string;
    file: File;
    previewUrl: string | null;
  }
  const [attachedFiles, setAttachedFiles] = useState<AttachedFileItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  // Loading states
  const [isGeneratingAi, setIsGeneratingAi] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const cleanPriorities = (prios: PmPriority[]) => {
    return (prios || []).filter((p) => p.id !== 'critical' && p.name.toLowerCase() !== 'critical');
  };

  // Initialize fields & load PM tool spaces strictly
  useEffect(() => {
    if (!open) return;

    const notesText = failureNotes || runResult?.notes || runResult?.failureReason || '';
    const effectiveBuild = buildVersion || runResult?.run?.buildVersion || runResult?.run?.build_version || '';
    const initialTitle = formatCleanDefaultTitle(currentCase?.title);
    const initialDesc = formatCleanDefaultDescription(
      currentCase?.title,
      currentCase?.pre_conditions || currentCase?.preConditions,
      stepOrder,
      stepInstruction,
      stepExpectedResult,
      allSteps,
      notesText,
      stepNote,
      runResult?.run?.environment,
      effectiveBuild,
      iterationIndex,
      totalIterations,
      iterationParameters,
      resolvedEnvironmentUrl
    );

    setTitle(initialTitle);
    setDescription(initialDesc);
    setSelectedSeverity('MEDIUM');
    setSelectedPriorityId('');
    setPriorities([]);
    setSpaces([]);
    setSelectedSpaceId('');
    setTicketUrl('');
    setAttachedFiles([]);
    setExistingEvidence(initialEvidenceAttachments || []);
    setExtractedObservation('');
    setObservationAppended(false);
    setDuplicateCandidates([]);
    setIncludeEvidenceInAi(true);
    setShowCustomAiPrompt(false);
    setCustomAiPrompt('');

    // Fetch AI config and check for existing open duplicate defects
    if (projectId) {
      getProjectAiConfigAction(projectId)
        .then((res) => {
          if (res) {
            setAiDraftEnabled(res.aiEnabled && res.config.defectDrafting);
            setAiVisionEnabled(res.aiEnabled && res.config.evidenceVision);
            setIncludeEvidenceInAi(res.aiEnabled && res.config.evidenceVision);
          }
        })
        .catch(() => null);

      checkDuplicateDefectsAction({
        projectId,
        testCaseId: currentCase?.id || runResult?.testCaseId,
        title: initialTitle,
        failedStepAction: stepInstruction,
        failureNotes: stepNote || notesText,
      })
        .then((dups) => setDuplicateCandidates(dups || []))
        .catch(() => null);
    }

    // Fetch Project Connection & Spaces from PM tool
    setLoadingSpaces(true);
    Promise.all([
      getPmSpacesAction(projectId),
      getProjectConnectionsAction(projectId).catch(() => null),
    ])
      .then(([spacesRes, connRes]) => {
        const isEnabled = connRes?.pm?.enabled ?? false;
        setIsPmConfigured(isEnabled);
        setCreateInPmTool(isEnabled);

        if (spacesRes.spaces && spacesRes.spaces.length > 0) {
          setSpaces(spacesRes.spaces);

          // Find project default space preference if configured, else default to first space
          const defaultSpaceId = connRes?.pm?.defaultSpace?.id;
          const defaultSpaceKey = connRes?.pm?.defaultSpace?.key;
          const matchingSpace = spacesRes.spaces.find(
            (s) => (defaultSpaceId && s.id === defaultSpaceId) || (defaultSpaceKey && s.key === defaultSpaceKey)
          );
          const initialSpace = matchingSpace || spacesRes.spaces[0];

          setSelectedSpaceId(initialSpace.id);
          const validPriorities = cleanPriorities(initialSpace.custom_priorities || []);
          if (validPriorities.length > 0) {
            setPriorities(validPriorities);
            const defaultPrio = validPriorities.find((p) => p.name.toLowerCase() === 'medium') || validPriorities[0];
            setSelectedPriorityId(defaultPrio.id);
            setSelectedSeverity(defaultPrio.severity);
          }
        } else {
          setSpaces([]);
          setSelectedSpaceId('');
          setPriorities([]);
          setSelectedPriorityId('');
        }
      })
      .catch(() => {
        setSpaces([]);
        setSelectedSpaceId('');
        setPriorities([]);
        setSelectedPriorityId('');
      })
      .finally(() => setLoadingSpaces(false));
  }, [open, currentCase, stepOrder, stepInstruction, stepExpectedResult, failureNotes, runResult, projectId]);

  // Handle in-memory Space change (0 extra API calls)
  const handleSpaceChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const spaceId = e.target.value;
    setSelectedSpaceId(spaceId);
    const space = spaces.find((s) => s.id === spaceId);
    if (space) {
      const validPriorities = cleanPriorities(space.custom_priorities || []);
      if (validPriorities.length > 0) {
        setPriorities(validPriorities);
        const defaultPrio = validPriorities.find((p) => p.name.toLowerCase() === 'medium') || validPriorities[0];
        setSelectedPriorityId(defaultPrio.id);
        setSelectedSeverity(defaultPrio.severity);
      }
    }
  };

  // Clean up object URLs
  useEffect(() => {
    return () => {
      attachedFiles.forEach((f) => {
        if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
      });
    };
  }, [attachedFiles]);

  const addFiles = (files: FileList | File[]) => {
    const newItems: AttachedFileItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (file.size > 25 * 1024 * 1024) {
        toast.error(`"${file.name}" exceeds 25MB limit`);
        continue;
      }
      const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : null;
      newItems.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
        file,
        previewUrl,
      });
    }
    if (newItems.length > 0) {
      setAttachedFiles((prev) => [...prev, ...newItems]);
    }
  };

  const handleRemoveFile = (id: string) => {
    setAttachedFiles((prev) => {
      const target = prev.find((f) => f.id === id);
      if (target?.previewUrl) URL.revokeObjectURL(target.previewUrl);
      return prev.filter((f) => f.id !== id);
    });
  };

  // Clipboard Paste (Cmd+V / Ctrl+V for screenshots)
  useEffect(() => {
    if (!open) return;

    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;

      const pastedFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1 || items[i].type.indexOf('video') !== -1) {
          const file = items[i].getAsFile();
          if (file) pastedFiles.push(file);
        }
      }

      if (pastedFiles.length > 0) {
        addFiles(pastedFiles);
        toast.info(`${pastedFiles.length} file(s) pasted from clipboard`);
      }
    };

    window.addEventListener('paste', handlePaste);
    return () => window.removeEventListener('paste', handlePaste);
  }, [open]);

  const handlePriorityChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const prioId = e.target.value;
    setSelectedPriorityId(prioId);
    const found = priorities.find((p) => p.id === prioId);
    if (found) {
      setSelectedSeverity(found.severity);
    }
  };

  const readInlineEvidenceParts = async (): Promise<DefectEvidencePart[]> => {
    const parts: DefectEvidencePart[] = [];
    for (const item of attachedFiles.slice(0, 3)) {
      const f = item.file;
      const ext = (f.name.split('.').pop() || '').toLowerCase();
      const isImg = f.type.startsWith('image/') || ['png', 'jpg', 'jpeg', 'webp', 'gif'].includes(ext);
      const isLog =
        f.type.startsWith('text/') ||
        f.type === 'application/json' ||
        ['log', 'txt', 'json', 'csv'].includes(ext);

      if (isImg && f.size <= 5 * 1024 * 1024) {
        try {
          const buf = await f.arrayBuffer();
          const bytes = new Uint8Array(buf);
          let binary = '';
          for (let i = 0; i < bytes.byteLength; i++) {
            binary += String.fromCharCode(bytes[i]);
          }
          parts.push({
            name: f.name,
            mimeType: f.type || 'image/png',
            data: typeof window !== 'undefined' ? window.btoa(binary) : '',
            isTextLog: false,
          });
        } catch {
          // ignore
        }
      } else if (isLog && f.size <= 2 * 1024 * 1024) {
        try {
          const text = await f.text();
          parts.push({
            name: f.name,
            mimeType: 'text/plain',
            data: text.length > 12000 ? text.slice(-12000) : text,
            isTextLog: true,
          });
        } catch {
          // ignore
        }
      }
    }
    return parts;
  };

  // AI Auto-Draft
  const handleAiWrite = async (customInstructionsOverride?: string) => {
    if (!currentCase) {
      toast.error('Test case details not available');
      return;
    }

    setIsGeneratingAi(true);
    try {
      const selectedSpace = spaces.find((s) => s.id === selectedSpaceId);
      const notesText = failureNotes || runResult?.notes || runResult?.failureReason || '';
      const effectiveBuild = buildVersion || runResult?.run?.buildVersion || runResult?.run?.build_version || undefined;
      const effectiveCustom =
        customInstructionsOverride !== undefined
          ? customInstructionsOverride.trim()
          : undefined;

      const shouldIncludeEvidence = includeEvidenceInAi && aiVisionEnabled;
      const attachmentIds = shouldIncludeEvidence
        ? existingEvidence.map((e) => e.id).filter(Boolean)
        : [];
      const inlineEvidence = shouldIncludeEvidence ? await readInlineEvidenceParts() : [];

      const report = await generateDefectReportAction({
        projectId,
        attachmentIds,
        inlineEvidence,
        includeEvidence: shouldIncludeEvidence,
        defectInput: {
          caseTitle: currentCase.title || 'Untitled Test Case',
          caseDescription: currentCase.description,
          moduleName: selectedSpace?.name,
          preConditions: currentCase.pre_conditions || currentCase.preConditions,
          failedStepOrder: stepOrder,
          failedStepAction: stepInstruction,
          failedStepExpected: stepExpectedResult,
          stepNote: stepNote || undefined,
          failureNotes: notesText || undefined,
          customInstructions: effectiveCustom || undefined,
          environment: runResult?.run?.environment || 'Staging',
          resolvedEnvironmentUrl,
          buildVersion: effectiveBuild,
          iterationIndex,
          totalIterations,
          iterationParameters,
          allSteps: allSteps.length > 0 ? allSteps : currentCase.steps || [],
        },
      });

      if (report) {
        setTitle(report.title);
        setDescription(report.description);
        setShowCustomAiPrompt(false);
        if (report.extractedObservation) {
          setExtractedObservation(report.extractedObservation);
          setObservationAppended(false);
        }
        if (report.severity) {
          setSelectedSeverity(report.severity as any);
          const matchingPrio = priorities.find((p) => p.severity === report.severity);
          if (matchingPrio) {
            setSelectedPriorityId(matchingPrio.id);
          }
        }
        checkDuplicateDefectsAction({
          projectId,
          testCaseId: currentCase?.id || runResult?.testCaseId,
          title: report.title,
          failedStepAction: stepInstruction,
          failureNotes: report.extractedObservation || stepNote || notesText,
        })
          .then((dups) => setDuplicateCandidates(dups || []))
          .catch(() => null);

        toast.success('Bug drafted by AI ✨');
      }
    } catch (err: any) {
      toast.error(err.message || 'Failed to draft AI report');
    } finally {
      setIsGeneratingAi(false);
    }
  };

  const handleSubmit = async () => {
    if (!title.trim()) {
      toast.error('Please enter a bug title');
      return;
    }
    if (!currentUser || !runResult) {
      toast.error('Session missing');
      return;
    }

    setIsSubmitting(true);
    try {
      const uploadedAttachments: Array<{ id: string; filename: string; url: string }> = [];

      if (attachedFiles.length > 0) {
        await Promise.all(
          attachedFiles.map(async (item) => {
            try {
              const formData = new FormData();
              formData.append('file', item.file);
              formData.append('entityId', runResult.id);
              formData.append('entityType', 'run_result');
              if (projectId) formData.append('projectId', projectId);

              let attachmentId: string | null = null;
              try {
                const res = await fetch('/api/v1/attachments/upload', {
                  method: 'POST',
                  body: formData,
                });
                if (res.ok) {
                  const uploadData = await res.json();
                  attachmentId = uploadData?.attachmentId;
                }
              } catch {
                // Fallback to Server Action
                const uploadRes = await uploadFileAction(formData);
                attachmentId = uploadRes?.attachmentId || null;
              }

              if (attachmentId) {
                uploadedAttachments.push({
                  id: attachmentId,
                  filename: item.file.name,
                  url: `/api/v1/attachments/${attachmentId}/download`,
                });
              } else {
                toast.error(`Failed to upload ${item.file.name}`);
              }
            } catch (uploadErr: any) {
              logger.warn(`Failed to upload defect evidence file: ${item.file.name}`, {
                component: 'RaiseDefectModal',
                action: 'uploadEvidence',
                filename: item.file.name,
                reason: uploadErr?.message,
              });
              toast.error(`Failed to upload ${item.file.name}: ${uploadErr?.message || 'Upload failed'}`);
            }
          })
        );
      }

      const allAttachments = [
        ...existingEvidence.map((e) => ({
          id: e.id,
          filename: e.filename,
          url: e.url || `/api/v1/attachments/${e.id}/download`,
        })),
        ...uploadedAttachments,
      ];

      const selectedSpace = spaces.find((s) => s.id === selectedSpaceId);
      const selectedPriority = priorities.find((p) => p.id === selectedPriorityId);

      const defect = await raiseDefectAction({
        runResultId: runResult.id,
        testCaseId: currentCase?.id || runResult.testCaseId,
        title: title.trim(),
        description: description.trim(),
        severity: selectedSeverity,
        priorityName: selectedPriority?.name,
        raisedBy: currentUser.id,
        ticketUrl: ticketUrl.trim() || undefined,
        createExternalTicket: createInPmTool && isPmConfigured,
        spaceId: selectedSpaceId || undefined,
        spaceKey: selectedSpace?.key || undefined,
        spaceName: selectedSpace?.name || undefined,
        attachmentUrl: allAttachments[0]?.url,
        attachmentFilename: allAttachments[0]?.filename,
        attachmentId: allAttachments[0]?.id,
        attachments: allAttachments,
      });

      if (defect.externalTicketId) {
        toast.success(`Defect logged & ${defect.externalTicketId} created in PM tool`);
      } else {
        toast.success('Defect raised successfully');
      }

      onSuccess(defect);
      onOpenChange(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to raise defect');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg bg-popover text-popover-foreground border border-border p-5 sm:rounded-2xl shadow-2xl">
        {/* Compact Header */}
        <DialogHeader className="p-0 pb-3 border-b border-border/50">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-red-500/10 flex items-center justify-center text-red-500 shrink-0">
              <Bug className="h-4 w-4" />
            </div>
            <div>
              <DialogTitle className="text-sm font-bold text-foreground">
                Create Bug
              </DialogTitle>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-3.5 py-1">
          {/* Space & Priority Row */}
          <div className="grid grid-cols-2 gap-3">
            {/* Space Dropdown (PM Tool Spaces Only) */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground flex items-center justify-between">
                <span>Space</span>
                {loadingSpaces && <Loader2 className="h-2.5 w-2.5 animate-spin text-primary" />}
              </label>
              <select
                value={selectedSpaceId}
                onChange={handleSpaceChange}
                disabled={loadingSpaces || spaces.length === 0}
                className="w-full h-8.5 rounded-lg border border-input bg-background/80 px-2.5 text-xs text-foreground font-medium focus:outline-none focus:border-primary/50 disabled:opacity-50"
              >
                {loadingSpaces ? (
                  <option value="" className="bg-popover text-popover-foreground">Loading spaces from PM tool...</option>
                ) : spaces.length === 0 ? (
                  <option value="" className="bg-popover text-popover-foreground">No PM spaces available</option>
                ) : (
                  spaces.map((s) => (
                    <option key={s.id} value={s.id} className="bg-popover text-popover-foreground">
                      🏢 {s.name}
                    </option>
                  ))
                )}
              </select>
            </div>

            {/* Priority Dropdown (Space-Specific from In-Memory Space Schema) */}
            <div className="space-y-1">
              <label className="text-[11px] font-medium text-muted-foreground block">
                Priority
              </label>
              <select
                value={selectedPriorityId}
                onChange={handlePriorityChange}
                disabled={loadingSpaces || !selectedSpaceId || priorities.length === 0}
                className="w-full h-8.5 rounded-lg border border-input bg-background/80 px-2.5 text-xs text-foreground font-medium focus:outline-none focus:border-primary/50 disabled:opacity-50"
              >
                {loadingSpaces ? (
                  <option value="" className="bg-popover text-popover-foreground">Loading...</option>
                ) : !selectedSpaceId || priorities.length === 0 ? (
                  <option value="" className="bg-popover text-popover-foreground">Select a space first...</option>
                ) : (
                  priorities.map((p) => {
                    const dot =
                      p.color === 'red' || p.severity === 'CRITICAL'
                        ? '🔴'
                        : p.color === 'orange' || p.severity === 'HIGH'
                        ? '🟠'
                        : p.color === 'yellow' || p.severity === 'MEDIUM'
                        ? '🟡'
                        : '🔵';
                    return (
                      <option key={p.id} value={p.id} className="bg-popover text-popover-foreground">
                        {dot} {p.name}
                      </option>
                    );
                  })
                )}
              </select>
            </div>
          </div>

          {/* Inline Duplicate Defect Warning */}
          {duplicateCandidates.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-2.5 space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold text-amber-400">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span>
                    Possible duplicate open {duplicateCandidates.length === 1 ? 'defect' : 'defects'} ({duplicateCandidates.length})
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => setDuplicateCandidates([])}
                  className="text-muted-foreground hover:text-foreground text-[10px] cursor-pointer"
                  title="Dismiss"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
              <div className="space-y-1 max-h-24 overflow-y-auto pr-1">
                {duplicateCandidates.map((dup) => (
                  <div
                    key={dup.id}
                    className="flex items-center justify-between gap-2 text-[11px] bg-background/60 rounded px-2 py-1 border border-border/40"
                  >
                    <div className="min-w-0 flex items-center gap-1.5 truncate">
                      <span className="font-mono text-[10px] font-bold text-amber-400 shrink-0">
                        {dup.externalTicketId || dup.id}
                      </span>
                      <span className="truncate text-foreground/90" title={dup.title}>
                        {dup.title}
                      </span>
                      {dup.sameCase && (
                        <span className="text-[9px] px-1 py-0.2 rounded bg-amber-500/20 text-amber-300 border border-amber-500/30 shrink-0">
                          Same case
                        </span>
                      )}
                    </div>
                    {dup.ticketUrl && (
                      <a
                        href={dup.ticketUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-0.5 text-[10px] text-primary hover:underline shrink-0 font-medium"
                      >
                        <span>View</span>
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Bug Title + AI Button */}
          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <label className="text-[11px] font-medium text-muted-foreground">Title</label>
              {aiDraftEnabled && (
                <div className="inline-flex items-center rounded-md border border-primary/25 bg-primary/5 overflow-hidden">
                  <button
                    type="button"
                    onClick={() => handleAiWrite('')}
                    disabled={isGeneratingAi}
                    className="inline-flex items-center gap-1 text-[11px] text-primary hover:bg-primary/10 px-2 py-0.5 font-medium transition-colors cursor-pointer disabled:opacity-50"
                    title="Draft bug report with AI (Auto)"
                  >
                    {isGeneratingAi ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        <span>Drafting...</span>
                      </>
                    ) : (
                      <>
                        <Sparkles className="h-3 w-3" />
                        <span>AI Draft</span>
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCustomAiPrompt((prev) => !prev)}
                    disabled={isGeneratingAi}
                    className={cn(
                      'inline-flex items-center gap-0.5 text-[10px] text-primary hover:bg-primary/10 px-1.5 py-0.5 border-l border-primary/20 font-medium transition-colors cursor-pointer disabled:opacity-50',
                      showCustomAiPrompt && 'bg-primary/15'
                    )}
                    title="Customize AI prompt instructions"
                  >
                    <span>{showCustomAiPrompt ? 'Custom' : 'Auto'}</span>
                    <ChevronDown
                      className={cn(
                        'h-2.5 w-2.5 transition-transform duration-150',
                        showCustomAiPrompt && 'rotate-180'
                      )}
                    />
                  </button>
                </div>
              )}
            </div>

            {aiDraftEnabled && showCustomAiPrompt && (
              <div className="p-2 rounded-lg border border-primary/30 bg-primary/5 space-y-1.5">
                <div className="flex items-center gap-1 flex-wrap">
                  {[
                    'Focus on premium calculation mismatch',
                    'Highlight API/network error from logs',
                    'Keep steps ultra-concise',
                  ].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setCustomAiPrompt(preset)}
                      className="text-[9.5px] px-1.5 py-0.5 rounded-full border border-primary/25 bg-background/80 hover:bg-primary/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                    >
                      {preset}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-1.5">
                  <Input
                    value={customAiPrompt}
                    onChange={(e) => setCustomAiPrompt(e.target.value)}
                    placeholder="Custom prompt: e.g. Emphasize 502 error on /quotes endpoint..."
                    disabled={isGeneratingAi}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAiWrite(customAiPrompt);
                      }
                    }}
                    className="h-7 text-xs flex-1 bg-background"
                  />
                  <Button
                    type="button"
                    size="sm"
                    disabled={isGeneratingAi}
                    onClick={() => handleAiWrite(customAiPrompt)}
                    className="h-7 px-2.5 text-[11px] font-semibold cursor-pointer gap-1 shrink-0"
                  >
                    <Sparkles className="h-2.5 w-2.5" />
                    <span>Run</span>
                  </Button>
                </div>
              </div>
            )}

            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="[Feature] Specific defect statement..."
              className="h-8.5 rounded-lg bg-background/80 border-input text-xs text-foreground font-medium focus-visible:ring-1 focus-visible:ring-primary/50"
            />
          </div>

          {/* Non-destructive Extracted Evidence Observation Suggestion */}
          {extractedObservation && (
            <div className="rounded-lg border border-primary/30 bg-primary/10 px-2.5 py-2 flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1 space-y-0.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-primary flex items-center gap-1">
                  <Sparkles className="h-2.5 w-2.5" />
                  <span>Extracted from evidence</span>
                </span>
                <p className="text-[11px] text-foreground/90 leading-snug break-words">
                  {extractedObservation}
                </p>
              </div>
              {onAppendStepNote && (
                <button
                  type="button"
                  disabled={observationAppended}
                  onClick={() => {
                    onAppendStepNote(stepOrder, extractedObservation);
                    setObservationAppended(true);
                    toast.success('Appended to step observation');
                  }}
                  className={cn(
                    "shrink-0 inline-flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold border transition-colors cursor-pointer",
                    observationAppended
                      ? "bg-emerald-500/15 text-emerald-400 border-emerald-500/30 cursor-default"
                      : "bg-primary/20 hover:bg-primary/30 text-primary border-primary/30"
                  )}
                >
                  {observationAppended ? (
                    <>
                      <Check className="h-3 w-3" />
                      <span>Added to Note</span>
                    </>
                  ) : (
                    <>
                      <Plus className="h-3 w-3" />
                      <span>Append to Step Note</span>
                    </>
                  )}
                </button>
              )}
            </div>
          )}

          {/* Description Textarea */}
          <div className="space-y-1">
            <label className="text-[11px] font-medium text-muted-foreground">Description & Steps</label>
            <Textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="### Steps to Reproduce..."
              className="min-h-[105px] max-h-[170px] rounded-lg bg-background/80 border-input text-xs text-foreground leading-relaxed focus-visible:ring-1 focus-visible:ring-primary/50 resize-y"
            />
          </div>

          {/* Media Attachment Bar */}
          <div className="space-y-1.5">
            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept="image/*,video/*,.pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.log,.json,.zip,.tar,.gz"
              className="hidden"
              onChange={(e) => {
                if (e.target.files?.length) {
                  addFiles(e.target.files);
                }
              }}
            />

            {aiDraftEnabled && aiVisionEnabled && (existingEvidence.length > 0 || attachedFiles.length > 0) && (
              <div className="flex items-center justify-between px-0.5">
                <label className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={includeEvidenceInAi}
                    onChange={(e) => setIncludeEvidenceInAi(e.target.checked)}
                    className="rounded border-input text-primary focus:ring-0 h-3.5 w-3.5 bg-background"
                  />
                  <span>Include evidence in AI draft (logs & screenshots)</span>
                </label>
              </div>
            )}

            {/* Pre-attached Evidence from Step or Case */}
            {existingEvidence.length > 0 && (
              <div className="space-y-1.5">
                <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider block">
                  Pre-attached Evidence ({existingEvidence.length})
                </span>
                <div className="space-y-1.5 max-h-32 overflow-y-auto pr-1">
                  {existingEvidence.map((att) => (
                    <div key={att.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-primary/20 bg-primary/5">
                      <div className="flex items-center gap-2 overflow-hidden min-w-0">
                        <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
                        <span className="text-xs text-foreground truncate max-w-[260px] font-medium" title={att.filename}>
                          {att.filename}
                        </span>
                        <span className="text-[9px] font-bold px-1.5 py-0.2 rounded bg-primary/20 text-primary border border-primary/30 uppercase tracking-wide shrink-0">
                          {att.source || 'Evidence'}
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => setExistingEvidence((prev) => prev.filter((e) => e.id !== att.id))}
                        className="text-muted-foreground hover:text-red-400 p-1 cursor-pointer"
                        title="Remove from defect"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {attachedFiles.length > 0 && (
              <div className="space-y-1.5 max-h-36 overflow-y-auto pr-1">
                {attachedFiles.map((att) => {
                  const ext = (att.file.name.split('.').pop() || '').toLowerCase();
                  const isImg = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext);
                  const isVideo = ['mp4', 'mov', 'webm', 'avi', 'mkv'].includes(ext) || att.file.type.startsWith('video/');
                  const isSpreadsheet = ['xlsx', 'xls', 'csv'].includes(ext);
                  const isPdf = ext === 'pdf';
                  const isDoc = ['doc', 'docx', 'txt', 'rtf'].includes(ext);

                  return (
                    <div key={att.id} className="flex items-center justify-between px-2.5 py-1.5 rounded-lg border border-border/60 bg-muted/40">
                      <div className="flex items-center gap-2 overflow-hidden min-w-0">
                        {att.previewUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={att.previewUrl} alt="Preview" className="h-7 w-7 object-cover rounded border border-border/60 shrink-0" />
                        ) : isVideo ? (
                          <Film className="h-4 w-4 text-blue-400 shrink-0" />
                        ) : isSpreadsheet ? (
                          <FileSpreadsheet className="h-4 w-4 text-emerald-400 shrink-0" />
                        ) : isPdf || isDoc ? (
                          <FileText className="h-4 w-4 text-red-400 shrink-0" />
                        ) : isImg ? (
                          <ImageIcon className="h-4 w-4 text-violet-400 shrink-0" />
                        ) : (
                          <Paperclip className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <span className="text-xs text-foreground truncate max-w-[280px] font-medium" title={att.file.name}>
                          {att.file.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground shrink-0 font-mono">
                          ({(att.file.size / 1024 / 1024).toFixed(1)}MB)
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveFile(att.id)}
                        className="text-muted-foreground hover:text-red-400 p-1 cursor-pointer"
                        title="Remove attachment"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div
              onClick={() => fileInputRef.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDragging(false);
                if (e.dataTransfer.files?.length) {
                  addFiles(e.dataTransfer.files);
                }
              }}
              className={cn(
                "border border-dashed rounded-lg px-3 py-2 text-center cursor-pointer transition-all flex items-center justify-center gap-2 text-xs",
                isDragging ? "border-primary bg-primary/10 text-primary" : "border-border/70 bg-muted/30 hover:bg-muted/50 text-muted-foreground"
              )}
            >
              <Paperclip className="h-3.5 w-3.5 text-primary shrink-0" />
              <span className="text-[11px]">
                {attachedFiles.length > 0 ? 'Attach more files' : 'Attach media'} or paste <kbd className="px-1 py-0.5 rounded bg-muted text-[9px] font-mono text-foreground border border-border/50">Cmd+V</kbd>
              </span>
            </div>
          </div>
        </div>

        {/* Unified Clean Footer */}
        <DialogFooter className="pt-3 border-t border-border/50 flex flex-row items-center justify-between gap-2 sm:gap-0">
          <div className="flex items-center gap-2">
            {isPmConfigured ? (
              <label className="flex items-center gap-1.5 cursor-pointer text-[11px] text-muted-foreground select-none hover:text-foreground transition-colors">
                <input
                  type="checkbox"
                  checked={createInPmTool}
                  onChange={(e) => setCreateInPmTool(e.target.checked)}
                  className="rounded border-input text-primary focus:ring-0 h-3.5 w-3.5 bg-background"
                />
                <span>Sync to PM Tool</span>
              </label>
            ) : (
              <Input
                value={ticketUrl}
                onChange={(e) => setTicketUrl(e.target.value)}
                placeholder="External ticket link..."
                className="h-7 w-40 rounded-md bg-background/80 border-input text-[11px]"
              />
            )}
          </div>

          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
              className="h-8 px-3 rounded-lg text-xs text-muted-foreground hover:text-foreground"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSubmit}
              disabled={isSubmitting || !title.trim()}
              className="h-8 px-3 rounded-lg text-xs font-semibold bg-red-600 hover:bg-red-700 text-white shadow-md gap-1"
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Saving...</span>
                </>
              ) : (
                <>
                  <Bug className="h-3 w-3" />
                  <span>Create Bug</span>
                </>
              )}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
