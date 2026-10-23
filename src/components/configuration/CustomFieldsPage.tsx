'use client';

import React, { useState, useEffect, useMemo } from 'react';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { Tooltip } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Tags,
  Plus,
  Trash2,
  Edit2,
  ChevronUp,
  ChevronDown,
  SlidersHorizontal,
  Check,
  X,
  AlertCircle,
  HelpCircle,
  Lock,
  ListFilter,
  Type,
  ToggleLeft,
  Hash,
  Link as LinkIcon,
  Layers,
  Sparkles
} from 'lucide-react';
import {
  getCustomFieldDefinitionsAction,
  createCustomFieldDefinitionAction,
  updateCustomFieldDefinitionAction,
  deleteCustomFieldDefinitionAction,
  reorderCustomFieldDefinitionsAction,
} from '@/app/actions/custom-fields';
import {
  sanitizeFieldKey,
  MAX_CUSTOM_FIELDS_PER_ENTITY,
  MAX_KEY_NAME_LENGTH,
  MAX_OPTION_LENGTH,
  MAX_OPTIONS_COUNT,
} from '@/lib/custom-fields';
import { CustomFieldType, CustomFieldEntityType } from '@prisma/client';

export function CustomFieldsPage({ projectId }: { projectId: string }) {
  const { project, members, currentUser } = useProjectData();

  const currentMember = members?.find((m: any) => m.userId === currentUser?.id);
  const currentUserRole = (currentMember?.role || (currentUser as any)?.role || '').toUpperCase();
  const isAdmin = currentUserRole === 'ADMIN' || currentUserRole === 'OWNER';

  const [loading, setLoading] = useState(true);
  const [activeEntity, setActiveEntity] = useState<CustomFieldEntityType>(CustomFieldEntityType.TEST_CASE);
  const [fields, setFields] = useState<any[]>([]);
  const [openOptionsDropdownId, setOpenOptionsDropdownId] = useState<string | null>(null);

  // Dialog state
  const [showModal, setShowModal] = useState(false);
  const [editingField, setEditingField] = useState<any | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    key: string;
    type: CustomFieldType;
    description: string;
    options: string[];
    newOptionText: string;
    required: boolean;
  }>({
    name: '',
    key: '',
    type: CustomFieldType.DROPDOWN,
    description: '',
    options: [],
    newOptionText: '',
    required: false,
  });
  const [saving, setSaving] = useState(false);

  // Delete modal state
  const [fieldToDelete, setFieldToDelete] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadFields = async () => {
    try {
      setLoading(true);
      const res = await getCustomFieldDefinitionsAction(projectId, activeEntity);
      setFields(res || []);
    } catch (e: any) {
      toast.error(e.message || 'Failed to load custom fields');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (projectId) {
      loadFields();
    }
  }, [projectId, activeEntity]);

  const openCreateModal = () => {
    setEditingField(null);
    setFormData({
      name: '',
      key: '',
      type: CustomFieldType.DROPDOWN,
      description: '',
      options: [],
      newOptionText: '',
      required: false,
    });
    setShowModal(true);
  };

  const openEditModal = (field: any) => {
    setEditingField(field);
    const opts = Array.isArray(field.options) ? field.options : [];
    setFormData({
      name: field.name,
      key: field.key,
      type: field.type,
      description: field.description || '',
      options: [...opts],
      newOptionText: '',
      required: Boolean(field.required),
    });
    setShowModal(true);
  };

  const handleNameChange = (val: string) => {
    const trimmed = val.slice(0, MAX_KEY_NAME_LENGTH);
    const lower = trimmed.toLowerCase().trim();
    if (!editingField) {
      const autoKey = sanitizeFieldKey(trimmed);
      setFormData((prev) => {
        let nextOptions = prev.options;
        if (prev.options.length === 0) {
          if (lower.includes('severity')) {
            nextOptions = ['Critical', 'High', 'Medium', 'Low'];
          } else if (lower.includes('type')) {
            nextOptions = ['Functional', 'Regression', 'Smoke', 'Integration', 'Security', 'Performance', 'Acceptance'];
          }
        }
        return { ...prev, name: trimmed, key: autoKey, options: nextOptions };
      });
    } else {
      setFormData((prev) => ({ ...prev, name: trimmed }));
    }
  };

  const handleAddOption = () => {
    const opt = formData.newOptionText.trim();
    if (!opt) return;
    if (opt.length > MAX_OPTION_LENGTH) {
      toast.error(`Option exceeds ${MAX_OPTION_LENGTH} characters`);
      return;
    }
    if (formData.options.map((o) => o.toLowerCase()).includes(opt.toLowerCase())) {
      toast.error('Option already exists');
      return;
    }
    if (formData.options.length >= MAX_OPTIONS_COUNT) {
      toast.error(`Maximum ${MAX_OPTIONS_COUNT} options allowed`);
      return;
    }
    setFormData((prev) => ({
      ...prev,
      options: [...prev.options, opt],
      newOptionText: '',
    }));
  };

  const handleRemoveOption = (index: number) => {
    setFormData((prev) => ({
      ...prev,
      options: prev.options.filter((_, i) => i !== index),
    }));
  };

  const handleSave = async () => {
    if (!formData.name.trim()) {
      toast.error('Field name is required');
      return;
    }
    if (
      (formData.type === CustomFieldType.DROPDOWN || formData.type === CustomFieldType.MULTI_SELECT) &&
      formData.options.length === 0
    ) {
      toast.error('Please add at least one option or select a preset');
      return;
    }

    setSaving(true);
    try {
      if (editingField) {
        await updateCustomFieldDefinitionAction(editingField.id, {
          name: formData.name.trim(),
          description: formData.description.trim() || undefined,
          options: formData.options,
          required: formData.required,
        });
        toast.success(`Property "${formData.name}" updated`);
      } else {
        await createCustomFieldDefinitionAction({
          projectId,
          entityType: activeEntity,
          name: formData.name.trim(),
          key: formData.key.trim() || undefined,
          type: formData.type,
          description: formData.description.trim() || undefined,
          options: formData.options,
          required: formData.required,
        });
        toast.success(`Property "${formData.name}" created`);
      }
      setShowModal(false);
      loadFields();
    } catch (e: any) {
      toast.error(e.message || 'Failed to save property');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!fieldToDelete) return;
    setDeleting(true);
    try {
      await deleteCustomFieldDefinitionAction(fieldToDelete.id);
      toast.success(`Property "${fieldToDelete.name}" removed`);
      setFieldToDelete(null);
      loadFields();
    } catch (e: any) {
      toast.error(e.message || 'Failed to delete property');
    } finally {
      setDeleting(false);
    }
  };

  const handleMove = async (index: number, direction: 'up' | 'down') => {
    if (!isAdmin) return;
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= fields.length) return;

    const reordered = [...fields];
    const [moved] = reordered.splice(index, 1);
    reordered.splice(targetIndex, 0, moved);

    setFields(reordered);
    try {
      await reorderCustomFieldDefinitionsAction(
        projectId,
        reordered.map((f) => f.id),
        activeEntity
      );
    } catch (e: any) {
      toast.error(e.message || 'Failed to reorder properties');
      loadFields();
    }
  };

  const isLimitReached = fields.length >= MAX_CUSTOM_FIELDS_PER_ENTITY;

  const getTypeIcon = (type: CustomFieldType) => {
    switch (type) {
      case CustomFieldType.DROPDOWN:
        return <ListFilter className="h-3.5 w-3.5 text-purple-400" />;
      case CustomFieldType.MULTI_SELECT:
        return <Layers className="h-3.5 w-3.5 text-indigo-400" />;
      case CustomFieldType.TEXT:
        return <Type className="h-3.5 w-3.5 text-blue-400" />;
      case CustomFieldType.BOOLEAN:
        return <ToggleLeft className="h-3.5 w-3.5 text-emerald-400" />;
      case CustomFieldType.NUMBER:
        return <Hash className="h-3.5 w-3.5 text-amber-400" />;
      case CustomFieldType.URL:
        return <LinkIcon className="h-3.5 w-3.5 text-cyan-400" />;
      default:
        return <Tags className="h-3.5 w-3.5 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Banner if not admin */}
      {!isAdmin && (
        <div className="p-3.5 rounded-xl border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs flex items-center gap-2">
          <Lock className="h-4 w-4 shrink-0" />
          <span>
            You are viewing custom properties in read-only mode. Only Workspace Owners and Project Admins can define,
            edit, or delete custom field definitions.
          </span>
        </div>
      )}

      {/* Header & Limits Meter */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 rounded-2xl border border-border/50 bg-card/60 backdrop-blur-sm shadow-xs">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-foreground">Custom Properties Schema</h2>
            <span
              className={cn(
                'text-[11px] font-mono px-2 py-0.5 rounded-full font-bold border',
                isLimitReached
                  ? 'bg-red-500/15 text-red-400 border-red-500/30'
                  : fields.length >= 10
                  ? 'bg-amber-500/15 text-amber-400 border-amber-500/30'
                  : 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30'
              )}
            >
              {fields.length} / {MAX_CUSTOM_FIELDS_PER_ENTITY} Configured
            </span>
          </div>
          <p className="text-xs text-muted-foreground">
            Configure custom attributes (Severity, Testing Type, etc.) to enrich test cases and execution metadata.
          </p>
        </div>

        <div className="flex items-center gap-2">
          {isAdmin ? (
            <Button
              onClick={openCreateModal}
              disabled={isLimitReached}
              className="gap-1.5 gradient-btn text-white text-xs h-8 shadow-xs cursor-pointer disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>New Property</span>
            </Button>
          ) : null}
        </div>
      </div>

      {/* Entity Tabs */}
      <div className="flex items-center gap-2 border-b border-border/40 pb-2">
        <button
          onClick={() => setActiveEntity(CustomFieldEntityType.TEST_CASE)}
          className={cn(
            'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2',
            activeEntity === CustomFieldEntityType.TEST_CASE
              ? 'bg-primary/10 text-primary border border-primary/25 shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <Tags className="h-3.5 w-3.5" />
          <span>Test Cases</span>
          <span className="text-[10px] px-1.5 py-0.2 rounded-full bg-muted font-mono">{fields.length}</span>
        </button>

        <button
          onClick={() => setActiveEntity(CustomFieldEntityType.TEST_RUN)}
          className={cn(
            'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2',
            activeEntity === CustomFieldEntityType.TEST_RUN
              ? 'bg-primary/10 text-primary border border-primary/25 shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <Layers className="h-3.5 w-3.5" />
          <span>Test Runs</span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-muted/60 text-muted-foreground font-normal">Extensible</span>
        </button>

        <button
          onClick={() => setActiveEntity(CustomFieldEntityType.RELEASE)}
          className={cn(
            'px-3.5 py-1.5 rounded-lg text-xs font-semibold transition-all cursor-pointer flex items-center gap-2',
            activeEntity === CustomFieldEntityType.RELEASE
              ? 'bg-primary/10 text-primary border border-primary/25 shadow-xs'
              : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
          )}
        >
          <Sparkles className="h-3.5 w-3.5" />
          <span>Releases</span>
          <span className="text-[10px] px-1 py-0.2 rounded bg-muted/60 text-muted-foreground font-normal">Extensible</span>
        </button>
      </div>

      {/* Fields List */}
      {loading ? (
        <div className="flex items-center justify-center p-12">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-primary border-t-transparent" />
        </div>
      ) : fields.length === 0 ? (
        <div className="p-12 text-center border border-dashed border-border/60 rounded-2xl bg-card/30 space-y-3">
          <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary mx-auto flex items-center justify-center">
            <Tags className="h-5 w-5" />
          </div>
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">No Custom Properties Configured</h3>
            <p className="text-xs text-muted-foreground max-w-md mx-auto">
              Add properties like <span className="font-medium text-foreground">Severity</span>,{' '}
              <span className="font-medium text-foreground">Testing Type</span> (Functional, Regression, Smoke), or{' '}
              <span className="font-medium text-foreground">Component</span> to categorize your test cases.
            </p>
          </div>
          {isAdmin && (
            <Button onClick={openCreateModal} size="sm" className="gap-1.5 text-xs gradient-btn text-white cursor-pointer mt-2">
              <Plus className="h-3.5 w-3.5" />
              <span>Create First Property</span>
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-2">
          {fields.map((field, idx) => {
            const opts = Array.isArray(field.options) ? field.options : [];
            return (
              <div
                key={field.id}
                className="group flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 rounded-xl border border-border/50 bg-card/60 hover:border-border/80 transition-all hover:shadow-xs"
              >
                <div className="flex items-center gap-3 min-w-0">
                  {isAdmin && (
                    <div className="flex flex-col gap-0.5 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 'up')}
                        disabled={idx === 0}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                        title="Move up"
                      >
                        <ChevronUp className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleMove(idx, 'down')}
                        disabled={idx === fields.length - 1}
                        className="p-0.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground disabled:opacity-20 cursor-pointer"
                        title="Move down"
                      >
                        <ChevronDown className="h-3 w-3" />
                      </button>
                    </div>
                  )}

                  <div className="p-2 rounded-lg bg-muted/60 border border-border/40 shrink-0">
                    {getTypeIcon(field.type)}
                  </div>

                  <div className="min-w-0 space-y-0.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs font-bold text-foreground truncate max-w-[180px]">{field.name}</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-muted/80 text-muted-foreground border border-border/30">
                        {field.key}
                      </span>
                      <span className="text-[10px] uppercase font-semibold px-1.5 py-0.2 rounded bg-primary/10 text-primary border border-primary/20">
                        {field.type.replace('_', ' ')}
                      </span>
                      {field.required && (
                        <span className="text-[10px] px-1.5 py-0.2 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20 font-medium">
                          Required
                        </span>
                      )}

                      {/* Clean Options Dropdown - avoids text and chip clutter */}
                      {opts.length > 0 && (
                        <div className="relative inline-block">
                          <button
                            type="button"
                            onClick={() => setOpenOptionsDropdownId(openOptionsDropdownId === field.id ? null : field.id)}
                            className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-md bg-muted/60 hover:bg-muted text-foreground/80 border border-border/40 transition-colors cursor-pointer"
                          >
                            <span>{opts.length} options</span>
                            <ChevronDown className={cn("h-3 w-3 transition-transform text-muted-foreground", openOptionsDropdownId === field.id && "rotate-180")} />
                          </button>
                          {openOptionsDropdownId === field.id && (
                            <>
                              <div className="fixed inset-0 z-40" onClick={() => setOpenOptionsDropdownId(null)} />
                              <div className="absolute left-0 top-full mt-1 z-50 w-48 bg-popover border border-border rounded-xl shadow-xl p-1.5 text-xs animate-in fade-in-0 duration-100 max-h-48 overflow-y-auto">
                                <div className="px-2 py-1 text-[10px] font-bold text-muted-foreground uppercase tracking-wider border-b border-border/30 mb-1">
                                  {field.name} Options ({opts.length})
                                </div>
                                {opts.map((opt: string) => (
                                  <div key={opt} className="px-2 py-1 rounded text-xs text-foreground/90 truncate hover:bg-muted/50">
                                    • {opt}
                                  </div>
                                ))}
                              </div>
                            </>
                          )}
                        </div>
                      )}
                    </div>

                    {field.description && (
                      <p className="text-[11px] text-muted-foreground truncate max-w-md">{field.description}</p>
                    )}
                  </div>
                </div>

                {isAdmin && (
                  <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => openEditModal(field)}
                      className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                    >
                      <Edit2 className="h-3 w-3 mr-1" />
                      <span>Edit</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setFieldToDelete(field)}
                      className="h-7 px-2 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 cursor-pointer"
                    >
                      <Trash2 className="h-3 w-3 mr-1" />
                      <span>Delete</span>
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Modal */}
      <Dialog open={showModal} onOpenChange={setShowModal}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="text-base font-bold">
              {editingField ? `Edit Property: ${editingField.name}` : 'Create Custom Property'}
            </DialogTitle>
            <DialogDescription className="text-xs text-muted-foreground">
              Define a custom property for {activeEntity.toLowerCase().replace('_', ' ')}s. Name is capped at 30
              characters.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2 text-xs">
            {/* Property Name */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="font-semibold text-foreground">Property Name</label>
                <span className="text-[10px] text-muted-foreground font-mono">
                  {formData.name.length} / {MAX_KEY_NAME_LENGTH}
                </span>
              </div>
              <Input
                placeholder="e.g. Severity, Testing Type, Component"
                value={formData.name}
                maxLength={MAX_KEY_NAME_LENGTH}
                onChange={(e) => handleNameChange(e.target.value)}
                className={cn("h-8 text-xs", !editingField && formData.name.trim() && fields.some(f => f.key === sanitizeFieldKey(formData.name) || f.name.toLowerCase() === formData.name.trim().toLowerCase()) && "border-red-500 focus-visible:ring-red-500")}
              />
              {!editingField && formData.name.trim() && fields.some(f => f.key === sanitizeFieldKey(formData.name) || f.name.toLowerCase() === formData.name.trim().toLowerCase()) && (
                <p className="text-[11px] text-red-400 flex items-center gap-1 font-medium pt-0.5">
                  <AlertCircle className="h-3 w-3 shrink-0" />
                  <span>A property with key &quot;{sanitizeFieldKey(formData.name)}&quot; already exists in this project.</span>
                </p>
              )}
            </div>

            {/* Property Key */}
            <div className="space-y-1.5">
              <div className="flex justify-between items-center">
                <label className="font-semibold text-foreground">Property Key (Identifier)</label>
                <span className="text-[10px] text-muted-foreground">Used internally & in API</span>
              </div>
              <Input
                placeholder="e.g. severity, testing_type"
                value={formData.key}
                disabled={Boolean(editingField)}
                maxLength={MAX_KEY_NAME_LENGTH}
                onChange={(e) => setFormData((prev) => ({ ...prev, key: sanitizeFieldKey(e.target.value) }))}
                className="h-8 text-xs font-mono disabled:opacity-60"
              />
            </div>

            {/* Field Type (Only changeable when creating) */}
            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Field Type</label>
              <select
                disabled={Boolean(editingField)}
                value={formData.type}
                onChange={(e) => setFormData((prev) => ({ ...prev, type: e.target.value as CustomFieldType }))}
                className="w-full h-8 rounded-md border border-border/60 bg-background px-2 text-xs disabled:opacity-60 cursor-pointer"
              >
                <option value={CustomFieldType.DROPDOWN}>Dropdown (Single Select)</option>
                <option value={CustomFieldType.MULTI_SELECT}>Multi-Select (Multiple Choice)</option>
                <option value={CustomFieldType.TEXT}>Text Field (Max 100 chars)</option>
                <option value={CustomFieldType.BOOLEAN}>Boolean (Yes / No Toggle)</option>
                <option value={CustomFieldType.NUMBER}>Numeric Field</option>
                <option value={CustomFieldType.URL}>URL / External Link</option>
              </select>
            </div>

            {/* Dropdown Options Builder */}
            {(formData.type === CustomFieldType.DROPDOWN || formData.type === CustomFieldType.MULTI_SELECT) && (
              <div className="space-y-2 p-3 rounded-xl border border-border/50 bg-muted/20">
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-foreground">Options List</span>
                  <div className="flex items-center gap-2">
                    {formData.options.length > 0 && (
                      <button
                        type="button"
                        onClick={() => setFormData((prev) => ({ ...prev, options: [] }))}
                        className="text-[10px] text-muted-foreground hover:text-destructive cursor-pointer underline"
                      >
                        Clear all
                      </button>
                    )}
                    <span className="text-[10px] text-muted-foreground font-mono">
                      {formData.options.length} / {MAX_OPTIONS_COUNT} options
                    </span>
                  </div>
                </div>

                {/* Preset suggestions */}
                <div className="flex items-center gap-1.5 flex-wrap pt-0.5">
                  <span className="text-[10px] text-muted-foreground font-medium">Presets:</span>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        options: ['Functional', 'Regression', 'Smoke', 'Integration', 'Security', 'Performance', 'Acceptance'],
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-primary/10 hover:bg-primary/20 text-primary border border-primary/20 text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    + Testing Type
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        options: ['Critical', 'High', 'Medium', 'Low'],
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border/40 text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    + Severity
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setFormData((prev) => ({
                        ...prev,
                        options: ['P0', 'P1', 'P2', 'P3'],
                      }))
                    }
                    className="px-2 py-0.5 rounded-md bg-muted hover:bg-muted/80 text-foreground border border-border/40 text-[10px] font-semibold cursor-pointer transition-colors"
                  >
                    + Priority
                  </button>
                </div>

                <div className="flex gap-2">
                  <Input
                    placeholder="Type an option and press Enter..."
                    value={formData.newOptionText}
                    maxLength={MAX_OPTION_LENGTH}
                    onChange={(e) => setFormData((prev) => ({ ...prev, newOptionText: e.target.value }))}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddOption();
                      }
                    }}
                    className="h-7 text-xs flex-1"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleAddOption}
                    disabled={!formData.newOptionText.trim() || formData.options.length >= MAX_OPTIONS_COUNT}
                    className="h-7 px-2.5 text-xs cursor-pointer"
                  >
                    Add
                  </Button>
                </div>

                {formData.options.length === 0 ? (
                  <p className="text-[11px] text-muted-foreground/80 py-1">
                    No options yet. Type custom options above or click a preset.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-1.5 pt-1 max-h-32 overflow-y-auto">
                    {formData.options.map((opt, i) => (
                      <span
                        key={opt}
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted text-foreground border border-border/40 text-[11px]"
                      >
                        <span className="truncate max-w-[120px]">{opt}</span>
                        <button
                          type="button"
                          onClick={() => handleRemoveOption(i)}
                          className="hover:text-red-400 cursor-pointer p-0.5"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Description */}
            <div className="space-y-1.5">
              <label className="font-semibold text-foreground">Description (Optional)</label>
              <Input
                placeholder="Helpful hint for testers..."
                value={formData.description}
                maxLength={100}
                onChange={(e) => setFormData((prev) => ({ ...prev, description: e.target.value }))}
                className="h-8 text-xs"
              />
            </div>

            {/* Required Flag */}
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={formData.required}
                onChange={(e) => setFormData((prev) => ({ ...prev, required: e.target.checked }))}
                className="rounded border-border text-primary focus:ring-primary h-3.5 w-3.5"
              />
              <span className="text-xs text-foreground font-medium">Require testers to fill this property</span>
            </label>
          </div>

          <DialogFooter className="gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setShowModal(false)}
              className="text-xs h-8 cursor-pointer"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSave}
              disabled={saving || !formData.name.trim() || (!editingField && fields.some(f => f.key === sanitizeFieldKey(formData.name) || f.name.toLowerCase() === formData.name.trim().toLowerCase()))}
              className="text-xs h-8 gradient-btn text-white cursor-pointer"
            >
              {saving ? 'Saving...' : editingField ? 'Save Changes' : 'Create Property'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Modal */}
      <ConfirmModal
        open={Boolean(fieldToDelete)}
        onOpenChange={(open) => { if (!open) setFieldToDelete(null); }}
        title="Delete Custom Property"
        description={`Are you sure you want to delete the property "${fieldToDelete?.name}"? Test cases currently holding values for this property will no longer display it.`}
        confirmLabel={deleting ? 'Deleting...' : 'Delete Property'}
        variant="destructive"
        onConfirm={handleDelete}
      />
    </div>
  );
}
