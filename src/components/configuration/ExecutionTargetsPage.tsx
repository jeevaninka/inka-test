'use client';

import { useState, useEffect, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ConfirmModal } from '@/components/common/ConfirmModal';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import {
  Smartphone,
  Globe,
  Server,
  Plus,
  Trash2,
  RotateCcw,
  SlidersHorizontal,
  Laptop,
  Compass,
  Apple,
  Boxes,
  MoreVertical,
  Edit3,
  AlertCircle
} from 'lucide-react';
import {
  getExecutionTargetsAction,
  saveExecutionTargetsAction,
  type ExecutionTargetsConfig,
  type BrowserTarget,
  type OperatingSystemTarget,
  type AppTarget,
  type CustomExecutionProperty
} from '@/app/actions/configuration';

type TabType = 'browsers' | 'os' | 'apps' | 'custom';

const VIEWPORT_OPTIONS = [
  '1920x1080 (Desktop FHD)',
  '1440x900 (Laptop)',
  '1366x768 (Laptop HD)',
  '1280x720 (HD)',
  '390x844 (iPhone 14)',
  '412x915 (Pixel 7)',
  '768x1024 (iPad)'
];

const APP_TYPES = [
  { value: 'webapp', label: 'Web Application' },
  { value: 'ios', label: 'Mobile App (iOS)' },
  { value: 'android', label: 'Mobile App (Android)' },
  { value: 'desktop', label: 'Desktop App (Electron / Native)' },
  { value: 'api', label: 'Backend / API Service' }
] as const;

const PROPERTY_TYPES = [
  { value: 'select', label: 'Select' },
  { value: 'text', label: 'Text' },
  { value: 'boolean', label: 'Boolean' }
] as const;

function deepCloneConfig(config: ExecutionTargetsConfig): ExecutionTargetsConfig {
  return JSON.parse(JSON.stringify(config));
}

function areConfigsEqual(a: ExecutionTargetsConfig | null, b: ExecutionTargetsConfig | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return JSON.stringify(a) === JSON.stringify(b);
}

export function ExecutionTargetsPage({ projectId }: { projectId: string }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [config, setConfig] = useState<ExecutionTargetsConfig | null>(null);
  const [originalConfig, setOriginalConfig] = useState<ExecutionTargetsConfig | null>(null);
  const [activeTab, setActiveTab] = useState<TabType>('browsers');

  // Browser modal
  const [showBrowserModal, setShowBrowserModal] = useState(false);
  const [editingBrowserId, setEditingBrowserId] = useState<string | null>(null);
  const [browserForm, setBrowserForm] = useState<Partial<BrowserTarget>>({
    name: '',
    defaultVersion: 'Latest',
    defaultViewport: '1920x1080 (Desktop FHD)',
    headless: false,
    enabled: true,
    versions: ['Latest'],
    viewports: ['1920x1080 (Desktop FHD)']
  });
  const [browserErrors, setBrowserErrors] = useState<Record<string, string>>({});

  // OS modal
  const [showOsModal, setShowOsModal] = useState(false);
  const [editingOsId, setEditingOsId] = useState<string | null>(null);
  const [osForm, setOsForm] = useState<Partial<OperatingSystemTarget>>({
    name: '',
    versions: ['Latest'],
    architectures: ['x64'],
    enabled: true
  });
  const [osErrors, setOsErrors] = useState<Record<string, string>>({});

  // App modal
  const [showAppModal, setShowAppModal] = useState(false);
  const [editingAppId, setEditingAppId] = useState<string | null>(null);
  const [appForm, setAppForm] = useState<Partial<AppTarget>>({
    name: '',
    type: 'webapp',
    identifier: '',
    buildVersion: '',
    environmentUrl: '',
    notes: '',
    enabled: true
  });
  const [appErrors, setAppErrors] = useState<Record<string, string>>({});

  // Custom property modal
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [editingCustomId, setEditingCustomId] = useState<string | null>(null);
  const [customForm, setCustomForm] = useState<Partial<CustomExecutionProperty>>({
    key: '',
    label: '',
    type: 'select',
    options: ['Option 1'],
    defaultValue: '',
    description: ''
  });
  const [customOptionsText, setCustomOptionsText] = useState('Option 1');
  const [customErrors, setCustomErrors] = useState<Record<string, string>>({});

  // Delete confirmation
  const [confirmDelete, setConfirmDelete] = useState<{
    open: boolean;
    type: 'browser' | 'os' | 'app' | 'custom';
    id: string;
    name: string;
  } | null>(null);

  const isDirty = useMemo(() => {
    return !areConfigsEqual(config, originalConfig);
  }, [config, originalConfig]);

  useEffect(() => {
    let cancelled = false;
    getExecutionTargetsAction(projectId)
      .then((data) => {
        if (!cancelled) {
          const cloned = deepCloneConfig(data);
          setConfig(cloned);
          setOriginalConfig(deepCloneConfig(cloned));
          setLoading(false);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          toast.error(err.message || 'Failed to load execution targets');
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  const handleSaveAll = async () => {
    if (!config || !isDirty || saving) return;
    setSaving(true);
    try {
      await saveExecutionTargetsAction(projectId, config);
      setOriginalConfig(deepCloneConfig(config));
      toast.success('Execution targets saved');
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save execution targets';
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  const openAddBrowser = () => {
    setEditingBrowserId(null);
    setBrowserForm({
      name: '',
      defaultVersion: 'Latest',
      defaultViewport: '1920x1080 (Desktop FHD)',
      headless: false,
      enabled: true,
      versions: ['Latest'],
      viewports: ['1920x1080 (Desktop FHD)']
    });
    setBrowserErrors({});
    setShowBrowserModal(true);
  };

  const openEditBrowser = (b: BrowserTarget) => {
    setEditingBrowserId(b.id);
    setBrowserForm({
      ...b,
      versions: b.versions?.length ? [...b.versions] : [b.defaultVersion || 'Latest'],
      viewports: b.viewports?.length ? [...b.viewports] : [b.defaultViewport || '1920x1080 (Desktop FHD)']
    });
    setBrowserErrors({});
    setShowBrowserModal(true);
  };

  const validateBrowser = (): boolean => {
    const errors: Record<string, string> = {};
    if (!browserForm.name?.trim()) errors.name = 'Browser name is required';
    if (!browserForm.defaultVersion?.trim()) errors.defaultVersion = 'Default version is required';
    if (!browserForm.defaultViewport?.trim()) errors.defaultViewport = 'Viewport is required';
    if (config) {
      const exists = config.browsers.some(
        (b) => b.id !== editingBrowserId && b.name.trim().toLowerCase() === browserForm.name?.trim().toLowerCase()
      );
      if (exists) errors.name = 'A browser with this name already exists';
    }
    setBrowserErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveBrowser = () => {
    if (!config || !validateBrowser()) return;
    const name = browserForm.name!.trim();
    const defaultVersion = browserForm.defaultVersion!.trim();
    const defaultViewport = browserForm.defaultViewport!.trim();
    if (editingBrowserId) {
      const next: ExecutionTargetsConfig = {
        ...config,
        browsers: config.browsers.map((b) =>
          b.id === editingBrowserId
            ? {
                ...b,
                name,
                defaultVersion,
                versions: browserForm.versions?.length ? browserForm.versions.filter(Boolean) : [defaultVersion],
                defaultViewport,
                viewports: browserForm.viewports?.length ? browserForm.viewports.filter(Boolean) : [defaultViewport],
                headless: Boolean(browserForm.headless),
                enabled: browserForm.enabled !== undefined ? browserForm.enabled : b.enabled
              }
            : b
        )
      };
      setConfig(next);
    } else {
      const newBrowser: BrowserTarget = {
        id: `browser-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        defaultVersion,
        versions: [defaultVersion],
        defaultViewport,
        viewports: [defaultViewport],
        headless: Boolean(browserForm.headless),
        enabled: browserForm.enabled !== undefined ? browserForm.enabled : true
      };
      const next: ExecutionTargetsConfig = {
        ...config,
        browsers: [...config.browsers, newBrowser]
      };
      setConfig(next);
    }
    setShowBrowserModal(false);
    toast.success(editingBrowserId ? 'Browser updated' : 'Browser added');
  };

  const toggleBrowser = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      browsers: config.browsers.map((b) => (b.id === id ? { ...b, enabled: !b.enabled } : b))
    });
  };

  const openAddOs = () => {
    setEditingOsId(null);
    setOsForm({ name: '', versions: ['Latest'], architectures: ['x64'], enabled: true });
    setOsErrors({});
    setShowOsModal(true);
  };

  const openEditOs = (o: OperatingSystemTarget) => {
    setEditingOsId(o.id);
    setOsForm({
      ...o,
      versions: o.versions?.length ? [...o.versions] : ['Latest'],
      architectures: o.architectures?.length ? [...o.architectures] : ['x64']
    });
    setOsErrors({});
    setShowOsModal(true);
  };

  const validateOs = (): boolean => {
    const errors: Record<string, string> = {};
    if (!osForm.name?.trim()) errors.name = 'OS name is required';
    if (!osForm.versions || osForm.versions.filter(Boolean).length === 0) errors.versions = 'At least one version is required';
    if (!osForm.architectures || osForm.architectures.filter(Boolean).length === 0) errors.architectures = 'At least one architecture is required';
    if (config) {
      const exists = config.operatingSystems.some(
        (o) => o.id !== editingOsId && o.name.trim().toLowerCase() === osForm.name?.trim().toLowerCase()
      );
      if (exists) errors.name = 'An OS with this name already exists';
    }
    setOsErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveOs = () => {
    if (!config || !validateOs()) return;
    const name = osForm.name!.trim();
    const versions = (osForm.versions || []).filter((v) => v && v.trim()).map((v) => v.trim());
    const architectures = (osForm.architectures || []).filter((v) => v && v.trim()).map((v) => v.trim());
    if (editingOsId) {
      setConfig({
        ...config,
        operatingSystems: config.operatingSystems.map((o) =>
          o.id === editingOsId ? { ...o, name, versions, architectures, enabled: osForm.enabled !== undefined ? osForm.enabled : o.enabled } : o
        )
      });
    } else {
      const newOs: OperatingSystemTarget = {
        id: `os-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        versions,
        architectures,
        enabled: true
      };
      setConfig({ ...config, operatingSystems: [...config.operatingSystems, newOs] });
    }
    setShowOsModal(false);
    toast.success(editingOsId ? 'Operating system updated' : 'Operating system added');
  };

  const toggleOs = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      operatingSystems: config.operatingSystems.map((o) => (o.id === id ? { ...o, enabled: !o.enabled } : o))
    });
  };

  const openAddApp = () => {
    setEditingAppId(null);
    setAppForm({ name: '', type: 'webapp', identifier: '', buildVersion: '', environmentUrl: '', notes: '', enabled: true });
    setAppErrors({});
    setShowAppModal(true);
  };

  const openEditApp = (a: AppTarget) => {
    setEditingAppId(a.id);
    setAppForm({ ...a });
    setAppErrors({});
    setShowAppModal(true);
  };

  const validateApp = (): boolean => {
    const errors: Record<string, string> = {};
    if (!appForm.name?.trim()) errors.name = 'Name is required';
    if (!appForm.type) errors.type = 'Type is required';
    const type = appForm.type;
    if (type === 'webapp') {
      if (!appForm.identifier?.trim() && !appForm.environmentUrl?.trim()) {
        errors.identifier = 'URL is required for web applications';
      } else {
        const url = (appForm.identifier || appForm.environmentUrl || '').trim();
        try {
          const parsed = new URL(url.startsWith('http') ? url : `https://${url}`);
          if (!parsed.hostname) errors.identifier = 'Enter a valid URL';
        } catch {
          errors.identifier = 'Enter a valid URL';
        }
      }
    } else if (type === 'ios' || type === 'android') {
      if (!appForm.identifier?.trim()) {
        errors.identifier = 'Bundle ID / Package name is required';
      } else if (!/^[a-z][a-z0-9_]*(\.[a-z0-9_]+)+$/i.test(appForm.identifier.trim())) {
        errors.identifier = 'Use a valid identifier format (e.g., com.company.app)';
      }
    } else if (type === 'api') {
      if (!appForm.identifier?.trim() && !appForm.environmentUrl?.trim()) {
        errors.identifier = 'Endpoint/identifier is required';
      }
    } else if (type === 'desktop') {
      if (!appForm.identifier?.trim()) {
        errors.identifier = 'Identifier is required';
      }
    }
    if (config) {
      const exists = config.apps.some(
        (a) => a.id !== editingAppId && a.name.trim().toLowerCase() === appForm.name?.trim().toLowerCase()
      );
      if (exists) errors.name = 'An app/target with this name already exists';
    }
    setAppErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveApp = () => {
    if (!config || !validateApp()) return;
    const name = appForm.name!.trim();
    const type = appForm.type as AppTarget['type'];
    const identifier = (appForm.identifier || appForm.environmentUrl || '').trim();
    const environmentUrl = appForm.environmentUrl?.trim() || (type === 'webapp' ? identifier : '');
    const buildVersion = appForm.buildVersion?.trim() || '';
    const notes = appForm.notes?.trim() || '';
    if (editingAppId) {
      setConfig({
        ...config,
        apps: config.apps.map((a) =>
          a.id === editingAppId ? { ...a, name, type, identifier, environmentUrl, buildVersion, notes, enabled: appForm.enabled !== undefined ? appForm.enabled : a.enabled } : a
        )
      });
    } else {
      const newApp: AppTarget = {
        id: `app-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        name,
        type,
        identifier,
        environmentUrl,
        buildVersion,
        notes,
        enabled: true
      };
      setConfig({ ...config, apps: [...config.apps, newApp] });
    }
    setShowAppModal(false);
    toast.success(editingAppId ? 'Target updated' : 'Target added');
  };

  const toggleApp = (id: string) => {
    if (!config) return;
    setConfig({
      ...config,
      apps: config.apps.map((a) => (a.id === id ? { ...a, enabled: !a.enabled } : a))
    });
  };

  const openAddCustom = () => {
    setEditingCustomId(null);
    setCustomForm({ key: '', label: '', type: 'select', options: ['Option 1'], defaultValue: '', description: '' });
    setCustomOptionsText('Option 1');
    setCustomErrors({});
    setShowCustomModal(true);
  };

  const openEditCustom = (p: CustomExecutionProperty) => {
    setEditingCustomId(p.id);
    setCustomForm({ ...p });
    setCustomOptionsText((p.options || []).join(', '));
    setCustomErrors({});
    setShowCustomModal(true);
  };

  const validateCustom = (): boolean => {
    const errors: Record<string, string> = {};
    if (!customForm.key?.trim()) errors.key = 'Key is required';
    else {
      const key = customForm.key.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
      if (!/^[A-Z][A-Z0-9_]*$/.test(key)) errors.key = 'Use uppercase letters, numbers, underscores';
    }
    if (!customForm.label?.trim()) errors.label = 'Label is required';
    const type = customForm.type || 'select';
    if (type === 'select') {
      const opts = customOptionsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (opts.length === 0) errors.options = 'At least one option required for select';
      if (customForm.defaultValue && !opts.includes(customForm.defaultValue.trim())) {
        errors.defaultValue = 'Default must be one of the options';
      }
    } else if (type === 'boolean') {
      // ok
    }
    if (config) {
      const keyNorm = (customForm.key || '').trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
      const exists = config.customProperties.some((p) => p.id !== editingCustomId && p.key === keyNorm);
      if (exists) errors.key = 'A property with this key already exists';
    }
    setCustomErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSaveCustom = () => {
    if (!config || !validateCustom()) return;
    const key = customForm.key!.trim().toUpperCase().replace(/[^A-Z0-9_]/g, '');
    const label = customForm.label!.trim();
    const type = customForm.type as CustomExecutionProperty['type'];
    let options: string[] | undefined = undefined;
    let defaultValue = customForm.defaultValue?.trim() || '';
    if (type === 'select') {
      options = customOptionsText
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
      if (!defaultValue && options.length > 0) defaultValue = options[0];
    } else if (type === 'boolean') {
      options = undefined;
      if (defaultValue !== 'true' && defaultValue !== 'false') defaultValue = 'false';
    }
    if (editingCustomId) {
      setConfig({
        ...config,
        customProperties: config.customProperties.map((p) =>
          p.id === editingCustomId ? { ...p, key, label, type, options, defaultValue, description: customForm.description?.trim() || '' } : p
        )
      });
    } else {
      const newProp: CustomExecutionProperty = {
        id: `prop-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        key,
        label,
        type,
        options,
        defaultValue,
        description: customForm.description?.trim() || ''
      };
      setConfig({ ...config, customProperties: [...config.customProperties, newProp] });
    }
    setShowCustomModal(false);
    toast.success(editingCustomId ? 'Property updated' : 'Property added');
  };

  const requestDelete = (type: 'browser' | 'os' | 'app' | 'custom', id: string, name: string) => {
    setConfirmDelete({ open: true, type, id, name });
  };

  const confirmDeleteAction = () => {
    if (!config || !confirmDelete) return;
    const { type, id } = confirmDelete;
    if (type === 'browser') {
      setConfig({ ...config, browsers: config.browsers.filter((b) => b.id !== id) });
      toast.success('Browser removed');
    } else if (type === 'os') {
      setConfig({ ...config, operatingSystems: config.operatingSystems.filter((o) => o.id !== id) });
      toast.success('Operating system removed');
    } else if (type === 'app') {
      setConfig({ ...config, apps: config.apps.filter((a) => a.id !== id) });
      toast.success('Target removed');
    } else if (type === 'custom') {
      setConfig({ ...config, customProperties: config.customProperties.filter((p) => p.id !== id) });
      toast.success('Property removed');
    }
    setConfirmDelete(null);
  };

  const resetChanges = () => {
    if (originalConfig) {
      setConfig(deepCloneConfig(originalConfig));
      toast.success('Changes reverted');
    }
  };

  if (loading || !config) {
    return (
      <div className="flex items-center justify-center h-64 text-xs text-muted-foreground gap-2">
        <span className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
        <span>Loading execution targets...</span>
      </div>
    );
  }

  const browserCount = config.browsers.length;
  const osCount = config.operatingSystems.length;
  const appCount = config.apps.length;
  const customCount = config.customProperties.length;

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between flex-wrap gap-4 border-b border-border/40 pb-4">
        <div>
          <h2 className="text-lg font-semibold text-foreground">Execution Targets</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Configure browsers, operating systems, apps/web apps, and runtime properties for test runs.
          </p>
        </div>
        <div className="flex items-center gap-2">
          {isDirty && (
            <Button size="sm" variant="outline" onClick={resetChanges} disabled={saving} className="h-8 text-xs">
              <RotateCcw className="h-3.5 w-3.5 mr-1" />
              Reset
            </Button>
          )}
          <Button
            size="sm"
            onClick={handleSaveAll}
            disabled={!isDirty || saving}
            className="h-8 text-xs font-semibold"
          >
            {saving ? 'Saving...' : isDirty ? 'Save Changes' : 'Saved'}
          </Button>
        </div>
      </div>

      {isDirty && (
        <div className="flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2">
          <AlertCircle className="h-3.5 w-3.5" />
          <span>You have unsaved changes. Save to apply them.</span>
        </div>
      )}

      <div className="flex items-center gap-1 p-1 bg-muted/40 rounded-lg border border-border/40 w-fit text-xs font-medium overflow-x-auto max-w-full">
        <button
          type="button"
          onClick={() => setActiveTab('browsers')}
          className={cn(
            'px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap',
            activeTab === 'browsers' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Compass className="h-3.5 w-3.5" />
          <span>Browsers ({browserCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('os')}
          className={cn(
            'px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap',
            activeTab === 'os' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Laptop className="h-3.5 w-3.5" />
          <span>Operating Systems ({osCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('apps')}
          className={cn(
            'px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap',
            activeTab === 'apps' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <Boxes className="h-3.5 w-3.5" />
          <span>Apps & WebApp ({appCount})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('custom')}
          className={cn(
            'px-2.5 py-1 rounded-md transition-colors flex items-center gap-1.5 whitespace-nowrap',
            activeTab === 'custom' ? 'bg-background text-foreground shadow-xs font-semibold' : 'text-muted-foreground hover:text-foreground'
          )}
        >
          <SlidersHorizontal className="h-3.5 w-3.5" />
          <span>Runtime Properties ({customCount})</span>
        </button>
      </div>

      {/* Browsers */}
      {activeTab === 'browsers' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Browsers</h3>
            <Button size="sm" variant="outline" onClick={openAddBrowser} className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Browser
            </Button>
          </div>
          {config.browsers.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
              No browsers configured. Add one to get started.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {config.browsers.map((b) => (
                <div
                  key={b.id}
                  className={cn(
                    'rounded-lg border p-3 flex flex-col justify-between min-h-[110px] transition-colors',
                    b.enabled ? 'bg-card border-border/70' : 'bg-muted/5 border-border/40'
                  )}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1 rounded-md bg-primary/10 text-primary shrink-0">
                          <Globe className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-foreground truncate">{b.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">
                            v{b.defaultVersion} · {b.defaultViewport}
                          </div>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6 -mr-1">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem onClick={() => openEditBrowser(b)}>
                            <Edit3 className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleBrowser(b.id)}>
                            {b.enabled ? 'Disable' : 'Enable'}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestDelete('browser', b.id, b.name)} className="text-red-600 focus:text-red-600">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', b.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border/40')}>
                        {b.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{b.headless ? 'Headless' : 'Headed'}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* OS */}
      {activeTab === 'os' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Operating Systems</h3>
            <Button size="sm" variant="outline" onClick={openAddOs} className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add OS
            </Button>
          </div>
          {config.operatingSystems.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
              No operating systems configured.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2.5">
              {config.operatingSystems.map((o) => (
                <div
                  key={o.id}
                  className={cn(
                    'rounded-lg border p-3 flex flex-col justify-between min-h-[110px] transition-colors',
                    o.enabled ? 'bg-card border-border/70' : 'bg-muted/5 border-border/40'
                  )}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div className="p-1 rounded-md bg-indigo-500/10 text-indigo-500">
                          <Laptop className="h-3.5 w-3.5" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-foreground truncate">{o.name}</div>
                          <div className="text-[10px] text-muted-foreground font-mono truncate">{o.architectures.join(' / ')}</div>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6 -mr-1">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem onClick={() => openEditOs(o)}>
                            <Edit3 className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleOs(o.id)}>{o.enabled ? 'Disable' : 'Enable'}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestDelete('os', o.id, o.name)} className="text-red-600 focus:text-red-600">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', o.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border/40')}>
                        {o.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className="text-[10px] text-muted-foreground truncate max-w-[60%]">{o.versions.join(', ')}</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Apps */}
      {activeTab === 'apps' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Apps & WebApp</h3>
            <Button size="sm" variant="outline" onClick={openAddApp} className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Target
            </Button>
          </div>
          {config.apps.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
              No application targets configured.
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2.5">
              {config.apps.map((app) => (
                <div
                  key={app.id}
                  className={cn(
                    'rounded-lg border p-3 flex flex-col justify-between min-h-[120px] transition-colors',
                    app.enabled ? 'bg-card border-border/70' : 'bg-muted/5 border-border/40'
                  )}
                >
                  <div className="space-y-2">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className={cn(
                            'p-1 rounded-md shrink-0',
                            app.type === 'webapp' && 'bg-blue-500/10 text-blue-500',
                            app.type === 'ios' && 'bg-zinc-500/10 text-zinc-500',
                            app.type === 'android' && 'bg-emerald-500/10 text-emerald-500',
                            app.type === 'desktop' && 'bg-purple-500/10 text-purple-500',
                            app.type === 'api' && 'bg-amber-500/10 text-amber-500'
                          )}
                        >
                          {app.type === 'webapp' && <Globe className="h-3.5 w-3.5" />}
                          {app.type === 'ios' && <Apple className="h-3.5 w-3.5" />}
                          {app.type === 'android' && <Smartphone className="h-3.5 w-3.5" />}
                          {app.type === 'desktop' && <Laptop className="h-3.5 w-3.5" />}
                          {app.type === 'api' && <Server className="h-3.5 w-3.5" />}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <div className="text-xs font-semibold text-foreground truncate">{app.name}</div>
                            <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-border/60 text-muted-foreground">{app.type}</span>
                          </div>
                          <div className="text-[10px] text-primary font-mono truncate">{app.identifier || app.environmentUrl || '-'}</div>
                        </div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-6 w-6 -mr-1">
                            <MoreVertical className="h-3.5 w-3.5" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-32">
                          <DropdownMenuItem onClick={() => openEditApp(app)}>
                            <Edit3 className="h-3.5 w-3.5 mr-2" /> Edit
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => toggleApp(app.id)}>{app.enabled ? 'Disable' : 'Enable'}</DropdownMenuItem>
                          <DropdownMenuItem onClick={() => requestDelete('app', app.id, app.name)} className="text-red-600 focus:text-red-600">
                            <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className={cn('text-[10px] px-1.5 py-0.5 rounded-full border', app.enabled ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30' : 'bg-muted text-muted-foreground border-border/40')}>
                        {app.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      {app.buildVersion && <span className="text-[10px] text-muted-foreground font-mono">Build {app.buildVersion}</span>}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Runtime Properties */}
      {activeTab === 'custom' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Runtime Properties</h3>
            <Button size="sm" variant="outline" onClick={openAddCustom} className="h-7 text-xs">
              <Plus className="h-3.5 w-3.5 mr-1" /> Add Property
            </Button>
          </div>
          {config.customProperties.length === 0 ? (
            <div className="text-center py-8 text-xs text-muted-foreground border border-dashed border-border/60 rounded-lg">
              No runtime properties configured.
            </div>
          ) : (
            <div className="rounded-lg border border-border/70 bg-card overflow-hidden divide-y divide-border/40">
              {config.customProperties.map((p) => (
                <div key={p.id} className="p-3 flex items-start justify-between gap-3">
                  <div className="space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[11px] font-semibold text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">{p.key}</span>
                      <span className="text-xs font-medium text-foreground">{p.label}</span>
                      <span className="text-[9px] uppercase px-1 py-0.5 rounded border border-border/60 text-muted-foreground">{p.type}</span>
                    </div>
                    {p.description && <p className="text-xs text-muted-foreground">{p.description}</p>}
                    {p.type === 'select' && p.options && p.options.length > 0 && (
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-muted-foreground">Options:</span>
                        {p.options.map((opt, i) => (
                          <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-muted/60 border border-border/40 font-mono">{opt}</span>
                        ))}
                        {p.defaultValue && <span className="text-[10px] text-muted-foreground">· Default: {p.defaultValue}</span>}
                      </div>
                    )}
                    {p.type === 'boolean' && <div className="text-[10px] text-muted-foreground">Default: {p.defaultValue || 'false'}</div>}
                    {p.type === 'text' && p.defaultValue && <div className="text-[10px] text-muted-foreground">Default: {p.defaultValue}</div>}
                  </div>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon" variant="ghost" className="h-7 w-7">
                        <MoreVertical className="h-3.5 w-3.5" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-32">
                      <DropdownMenuItem onClick={() => openEditCustom(p)}>
                        <Edit3 className="h-3.5 w-3.5 mr-2" /> Edit
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => requestDelete('custom', p.id, p.label)} className="text-red-600 focus:text-red-600">
                        <Trash2 className="h-3.5 w-3.5 mr-2" /> Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Browser Modal */}
      <Dialog open={showBrowserModal} onOpenChange={setShowBrowserModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingBrowserId ? 'Edit Browser' : 'Add Browser'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium block mb-1">Browser Name <span className="text-red-500">*</span></label>
              <Input value={browserForm.name || ''} onChange={(e) => setBrowserForm({ ...browserForm, name: e.target.value })} placeholder="e.g., Google Chrome" />
              {browserErrors.name && <p className="text-[11px] text-red-500 mt-1">{browserErrors.name}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Default Version <span className="text-red-500">*</span></label>
              <Input value={browserForm.defaultVersion || ''} onChange={(e) => setBrowserForm({ ...browserForm, defaultVersion: e.target.value })} placeholder="e.g., Latest" />
              {browserErrors.defaultVersion && <p className="text-[11px] text-red-500 mt-1">{browserErrors.defaultVersion}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Default Viewport <span className="text-red-500">*</span></label>
              <select
                value={browserForm.defaultViewport || ''}
                onChange={(e) => setBrowserForm({ ...browserForm, defaultViewport: e.target.value })}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                {VIEWPORT_OPTIONS.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              {browserErrors.defaultViewport && <p className="text-[11px] text-red-500 mt-1">{browserErrors.defaultViewport}</p>}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={!!browserForm.headless} onChange={(e) => setBrowserForm({ ...browserForm, headless: e.target.checked })} className="rounded" />
              Run headless by default
            </label>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={browserForm.enabled !== false} onChange={(e) => setBrowserForm({ ...browserForm, enabled: e.target.checked })} className="rounded" />
              Enabled
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowBrowserModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveBrowser}>{editingBrowserId ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* OS Modal */}
      <Dialog open={showOsModal} onOpenChange={setShowOsModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingOsId ? 'Edit Operating System' : 'Add Operating System'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium block mb-1">OS Name <span className="text-red-500">*</span></label>
              <Input value={osForm.name || ''} onChange={(e) => setOsForm({ ...osForm, name: e.target.value })} placeholder="e.g., macOS" />
              {osErrors.name && <p className="text-[11px] text-red-500 mt-1">{osErrors.name}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Versions <span className="text-red-500">*</span> (comma separated)</label>
              <Input
                value={(osForm.versions || []).join(', ')}
                onChange={(e) => setOsForm({ ...osForm, versions: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="e.g., 14.5 Sonoma, Latest"
              />
              {osErrors.versions && <p className="text-[11px] text-red-500 mt-1">{osErrors.versions}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Architectures <span className="text-red-500">*</span> (comma separated)</label>
              <Input
                value={(osForm.architectures || []).join(', ')}
                onChange={(e) => setOsForm({ ...osForm, architectures: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
                placeholder="e.g., ARM64, x64"
              />
              {osErrors.architectures && <p className="text-[11px] text-red-500 mt-1">{osErrors.architectures}</p>}
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={osForm.enabled !== false} onChange={(e) => setOsForm({ ...osForm, enabled: e.target.checked })} className="rounded" />
              Enabled
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowOsModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveOs}>{editingOsId ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* App Modal */}
      <Dialog open={showAppModal} onOpenChange={setShowAppModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingAppId ? 'Edit Target' : 'Add Application / WebApp Target'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium block mb-1">Name <span className="text-red-500">*</span></label>
              <Input value={appForm.name || ''} onChange={(e) => setAppForm({ ...appForm, name: e.target.value })} placeholder="e.g., Staging Web App" />
              {appErrors.name && <p className="text-[11px] text-red-500 mt-1">{appErrors.name}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Type <span className="text-red-500">*</span></label>
              <select
                value={appForm.type || 'webapp'}
                onChange={(e) => setAppForm({ ...appForm, type: e.target.value as AppTarget['type'] })}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                {APP_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {appForm.type === 'webapp' && (
              <div>
                <label className="text-xs font-medium block mb-1">URL <span className="text-red-500">*</span></label>
                <Input value={appForm.identifier || appForm.environmentUrl || ''} onChange={(e) => setAppForm({ ...appForm, identifier: e.target.value, environmentUrl: e.target.value })} placeholder="https://example.com" />
                {appErrors.identifier && <p className="text-[11px] text-red-500 mt-1">{appErrors.identifier}</p>}
              </div>
            )}
            {(appForm.type === 'ios' || appForm.type === 'android') && (
              <div>
                <label className="text-xs font-medium block mb-1">Bundle ID / Package Name <span className="text-red-500">*</span></label>
                <Input value={appForm.identifier || ''} onChange={(e) => setAppForm({ ...appForm, identifier: e.target.value })} placeholder="com.company.app" />
                {appErrors.identifier && <p className="text-[11px] text-red-500 mt-1">{appErrors.identifier}</p>}
              </div>
            )}
            {appForm.type === 'api' && (
              <div>
                <label className="text-xs font-medium block mb-1">Endpoint / Identifier <span className="text-red-500">*</span></label>
                <Input value={appForm.identifier || appForm.environmentUrl || ''} onChange={(e) => setAppForm({ ...appForm, identifier: e.target.value, environmentUrl: e.target.value })} placeholder="https://api.example.com" />
                {appErrors.identifier && <p className="text-[11px] text-red-500 mt-1">{appErrors.identifier}</p>}
              </div>
            )}
            {appForm.type === 'desktop' && (
              <div>
                <label className="text-xs font-medium block mb-1">Identifier <span className="text-red-500">*</span></label>
                <Input value={appForm.identifier || ''} onChange={(e) => setAppForm({ ...appForm, identifier: e.target.value })} placeholder="App identifier" />
                {appErrors.identifier && <p className="text-[11px] text-red-500 mt-1">{appErrors.identifier}</p>}
              </div>
            )}
            <div>
              <label className="text-xs font-medium block mb-1">Build / Release Version</label>
              <Input value={appForm.buildVersion || ''} onChange={(e) => setAppForm({ ...appForm, buildVersion: e.target.value })} placeholder="v1.0.0" />
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Notes</label>
              <Textarea value={appForm.notes || ''} onChange={(e) => setAppForm({ ...appForm, notes: e.target.value })} rows={2} className="text-xs" />
            </div>
            <label className="flex items-center gap-2 text-xs">
              <input type="checkbox" checked={appForm.enabled !== false} onChange={(e) => setAppForm({ ...appForm, enabled: e.target.checked })} className="rounded" />
              Enabled
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowAppModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveApp}>{editingAppId ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Custom Property Modal */}
      <Dialog open={showCustomModal} onOpenChange={setShowCustomModal}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingCustomId ? 'Edit Property' : 'Add Runtime Property'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-1">
            <div>
              <label className="text-xs font-medium block mb-1">Key <span className="text-red-500">*</span></label>
              <Input value={customForm.key || ''} onChange={(e) => setCustomForm({ ...customForm, key: e.target.value.toUpperCase() })} placeholder="NETWORK_PROFILE" />
              {customErrors.key && <p className="text-[11px] text-red-500 mt-1">{customErrors.key}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Display Label <span className="text-red-500">*</span></label>
              <Input value={customForm.label || ''} onChange={(e) => setCustomForm({ ...customForm, label: e.target.value })} placeholder="Network Profile" />
              {customErrors.label && <p className="text-[11px] text-red-500 mt-1">{customErrors.label}</p>}
            </div>
            <div>
              <label className="text-xs font-medium block mb-1">Type</label>
              <select
                value={customForm.type || 'select'}
                onChange={(e) => setCustomForm({ ...customForm, type: e.target.value as CustomExecutionProperty['type'] })}
                className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
              >
                {PROPERTY_TYPES.map((t) => (
                  <option key={t.value} value={t.value}>{t.label}</option>
                ))}
              </select>
            </div>
            {customForm.type === 'select' && (
              <>
                <div>
                  <label className="text-xs font-medium block mb-1">Options (comma separated) <span className="text-red-500">*</span></label>
                  <Input value={customOptionsText} onChange={(e) => setCustomOptionsText(e.target.value)} placeholder="Option 1, Option 2" />
                  {customErrors.options && <p className="text-[11px] text-red-500 mt-1">{customErrors.options}</p>}
                </div>
                <div>
                  <label className="text-xs font-medium block mb-1">Default Value</label>
                  <Input value={customForm.defaultValue || ''} onChange={(e) => setCustomForm({ ...customForm, defaultValue: e.target.value })} placeholder="Option 1" />
                  {customErrors.defaultValue && <p className="text-[11px] text-red-500 mt-1">{customErrors.defaultValue}</p>}
                </div>
              </>
            )}
            {customForm.type === 'boolean' && (
              <div>
                <label className="text-xs font-medium block mb-1">Default Value</label>
                <select
                  value={customForm.defaultValue || 'false'}
                  onChange={(e) => setCustomForm({ ...customForm, defaultValue: e.target.value })}
                  className="w-full h-9 rounded-md border border-input bg-background px-2 text-xs"
                >
                  <option value="false">false</option>
                  <option value="true">true</option>
                </select>
              </div>
            )}
            {customForm.type === 'text' && (
              <div>
                <label className="text-xs font-medium block mb-1">Default Value</label>
                <Input value={customForm.defaultValue || ''} onChange={(e) => setCustomForm({ ...customForm, defaultValue: e.target.value })} placeholder="Default text" />
              </div>
            )}
            <div>
              <label className="text-xs font-medium block mb-1">Description</label>
              <Input value={customForm.description || ''} onChange={(e) => setCustomForm({ ...customForm, description: e.target.value })} placeholder="Description for testers" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" size="sm" onClick={() => setShowCustomModal(false)}>Cancel</Button>
            <Button size="sm" onClick={handleSaveCustom}>{editingCustomId ? 'Save' : 'Add'}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={confirmDelete?.open || false}
        onOpenChange={(open) => !open && setConfirmDelete(null)}
        title="Delete target"
        description={`Are you sure you want to remove "${confirmDelete?.name}"? This action cannot be undone.`}
        confirmLabel="Delete"
        variant="destructive"
        onConfirm={confirmDeleteAction}
      />
    </div>
  );
}
