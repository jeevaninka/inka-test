"use client";
import React, { useState, useRef } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight, Upload, X, CheckCircle2, Sparkles, Loader2, Link2, Layers, Folder, Tag, FileText, AlertTriangle } from 'lucide-react';
import { importTestCasesAction, findExistingCaseTitlesAction } from '@/app/actions/cases';
import { createModuleAction } from '@/app/actions/modules';
import { enrichTestCasesWithAIAction } from '@/app/actions/ai';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { PriorityBadge } from '@/components/common/PriorityBadge';
import { ModuleSelect } from '@/components/common/ModuleSelect';
import { cn } from '@/lib/utils';
import { logger } from '@/lib/logger.client';

interface ImportTestCasesDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: string;
  onSuccess?: () => void;
}

interface ParsedStep {
  order: number;
  step: string;
  expectedResult?: string;
  data?: string;
  reusableStepId?: string | null;
}

interface ParsedCase {
  _id: string; // internal id for selection
  title: string;
  description?: string;
  preConditions?: string;
  postConditions?: string;
  priority: string;
  type: string;
  status: string;
  tags: string[];
  moduleName?: string;
  moduleId: string | null;
  scenarioType?: string;
  customFields?: Record<string, any>;
  steps: ParsedStep[];
  selected: boolean;
  expanded: boolean;
  isEnriched?: boolean;
  _originalCase?: Omit<ParsedCase, 'selected' | 'expanded' | 'isEnriched' | '_originalCase'>;
}

const getValueByPossibleKeys = (row: any, possibleKeys: string[]) => {
  for (const key of possibleKeys) {
    if (row[key] !== undefined && row[key] !== null) return row[key];
  }
  
  const normalize = (s: string) => s.toLowerCase().replace(/[\s\-_]/g, '');
  const normalizedPossibleKeys = possibleKeys.map(normalize);
  
  for (const key of Object.keys(row)) {
    const normKey = normalize(key);
    if (normalizedPossibleKeys.includes(normKey)) {
      return row[key];
    }
  }
  return undefined;
};

const cleanModuleId = (id: any): string | null => {
  if (!id) return null;
  const s = id.toString().trim();
  if (s === 'null' || s === 'undefined' || s === 'module_id_or_null' || s === '') return null;
  return s;
};

const cleanString = (val: any): string => {
  if (!val) return '';
  const s = val.toString().trim();
  if (s === '...' || s === 'null' || s === 'undefined') return '';
  return s;
};

const predictPriority = (title: string, originalPriority?: string): string => {
  if (originalPriority) {
    const cleanPriority = originalPriority.trim().toUpperCase();
    if (['P0', 'P1', 'P2', 'P3'].includes(cleanPriority)) return cleanPriority;
    
    // Convert common terms
    if (/critical|blocker|p0|severity\s*1/i.test(cleanPriority)) return 'P0';
    if (/high|urgent|p1|prio1|severity\s*2/i.test(cleanPriority)) return 'P1';
    if (/medium|med|moderate|p2|prio2|severity\s*3/i.test(cleanPriority)) return 'P2';
    if (/low|minor|trivial|p3|prio3|severity\s*4/i.test(cleanPriority)) return 'P3';
  }

  const titleLower = title.toLowerCase();
  // P0: Core revenue, auth, security, payments, data corruption/crashes
  if (/crash|blocker|payment|checkout|stripe|razorpay|security|vulnerability|bypass|login|signup|auth|register|unauthorized|forbidden|data.?loss/i.test(titleLower)) {
    return 'P0';
  }
  // P1: Main features, primary happy-paths, key CRUD workflows, critical errors
  if (/create|update|delete|save|submit|book|cancel|transaction|sync|transfer|core|api|validate|error|failed|cannot|unable|invalid/i.test(titleLower)) {
    return 'P1';
  }
  // P3: Minor UI, styling, cosmetic formatting, labels, tooltips
  if (/button|style|ui|text|font|color|alignment|margin|spacing|css|tooltip|icon|placeholder|label|copy/i.test(titleLower)) {
    return 'P3';
  }
  return 'P2';
};

const predictType = (title: string, steps: string[], originalType?: string): string => {
  if (originalType) {
    const cleanType = originalType.trim().toLowerCase();
    if (cleanType.includes('auto') || cleanType.includes('api') || cleanType.includes('script')) return 'auto';
    if (cleanType.includes('manual')) return 'manual';
  }

  const textToSearch = (title + ' ' + steps.join(' ')).toLowerCase();
  if (/automated|automation|api|script|selenium|playwright|cypress|testcafe|jest|unittest|pytest|http|post\s+request|get\s+request/i.test(textToSearch)) {
    return 'auto';
  }
  return 'manual';
};

export function ImportTestCasesDialog({ open, onOpenChange, projectId, onSuccess }: ImportTestCasesDialogProps) {
  const { project, modules, setModules, cases, setCases, suites = [], setSuites } = useProjectData();
  const fileInputRef = useRef<HTMLInputElement>(null);
  
  const [file, setFile] = useState<File | null>(null);
  const [parsedCases, setParsedCases] = useState<ParsedCase[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isAiRefining, setIsAiRefining] = useState(false);
  const [importStatus, setImportStatus] = useState<'active' | 'draft'>('active');
  const [selectedSuiteId, setSelectedSuiteId] = useState<string>('none');
  const [isCreatingNewSuite, setIsCreatingNewSuite] = useState(false);
  const [newSuiteName, setNewSuiteName] = useState('');
  const [selectedModuleOption, setSelectedModuleOption] = useState<string>('auto');
  const [importTagsInput, setImportTagsInput] = useState('');
  const [importTicketKey, setImportTicketKey] = useState('');
  const [showCustomAiPrompt, setShowCustomAiPrompt] = useState(false);
  const [customAiPrompt, setCustomAiPrompt] = useState('');

  const resetState = () => {
    setFile(null);
    setParsedCases([]);
    setIsParsing(false);
    setIsImporting(false);
    setIsAiRefining(false);
    setImportStatus('active');
    setSelectedSuiteId('none');
    setIsCreatingNewSuite(false);
    setNewSuiteName('');
    setSelectedModuleOption('auto');
    setImportTagsInput('');
    setImportTicketKey('');
    setShowCustomAiPrompt(false);
    setCustomAiPrompt('');
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleOpenChange = (newOpen: boolean) => {
    if (!newOpen) {
      resetState();
    }
    onOpenChange(newOpen);
  };

  const triggerAiEnrichment = async (casesToEnrich: ParsedCase[], customInstructionsOverride?: string) => {
    setIsAiRefining(true);
    try {
      const effectiveCustom =
        customInstructionsOverride !== undefined
          ? customInstructionsOverride.trim()
          : customAiPrompt.trim();
      const result = await enrichTestCasesWithAIAction({
        projectId,
        customInstructions: effectiveCustom || undefined,
        cases: casesToEnrich.map(c => ({
          _id: c._id,
          title: c.title,
          description: c.description,
          preConditions: c.preConditions,
          postConditions: c.postConditions,
          priority: c.priority,
          type: c.type,
          scenarioType: c.scenarioType,
          steps: c.steps.map(s => ({
            order: s.order,
            step: s.step,
            expectedResult: s.expectedResult,
            data: s.data
          }))
        }))
      });

      if (result && Array.isArray(result)) {
        setParsedCases(prev => {
          return prev.map(original => {
            const match = result.find(r => r._id === original._id);
            if (match) {
              const suggestedId = cleanModuleId(match.suggestedModuleId);
              return {
                ...original,
                title: cleanString(match.title) || original.title,
                description: cleanString(match.description) || original.description,
                preConditions: cleanString(match.preConditions) || original.preConditions,
                postConditions: cleanString(match.postConditions) || original.postConditions,
                priority: match.priority || original.priority,
                type: match.type || original.type,
                tags: Array.from(new Set([...original.tags, ...(match.suggestedTags || [])])),
                moduleId: suggestedId !== null ? suggestedId : original.moduleId,
                scenarioType: cleanString(match.scenarioType) || original.scenarioType,
                isEnriched: true,
                steps: match.steps && match.steps.length > 0 ? match.steps.map((s: any) => ({
                  order: s.order,
                  step: cleanString(s.step),
                  expectedResult: cleanString(s.expectedResult),
                  data: cleanString(s.data),
                  reusableStepId: cleanString(s.reusableStepId) || null
                })) : original.steps
              };
            }
            return original;
          });
        });
        toast.success("🤖 AI has enriched test cases and predicted priorities successfully!");
      }
    } catch (err) {
      logger.error('AI enrichment background task failed', {
        component: 'ImportTestCasesDialog',
        action: 'enrichTestCasesWithAI',
        projectId,
        error: err,
      });
    } finally {
      setIsAiRefining(false);
    }
  };

  const parseFile = async (selectedFile: File) => {
    setIsParsing(true);
    try {
      const isCsv = /\.csv$/i.test(selectedFile.name) || selectedFile.type === 'text/csv';
      let workbook: any;
      if (isCsv) {
        // CSV is parsed by the same sheet reader, from text rather than bytes.
        const text = await selectedFile.text();
        const XLSX = await import('xlsx');
        workbook = XLSX.read(text, { type: 'string', raw: true });
      } else {
        const data = await selectedFile.arrayBuffer();
        const XLSX = await import('xlsx');
        workbook = XLSX.read(data);
      }
      const XLSX = await import('xlsx');
      const firstSheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[firstSheetName];

      // Read raw 2D array of rows
      const rawRows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '' }) as any[][];
      if (!rawRows || rawRows.length === 0) {
        toast.error('The selected Excel sheet is empty.');
        setIsParsing(false);
        return;
      }

      // 1. Detect the true header row index by scanning first 15 rows
      let headerRowIndex = -1;
      const recognizedKeywords = [
        'testcase', 'title', 'casetitle', 'testcasename', 'testscenario', 'scenario',
        'teststeps', 'steps', 'step', 'action', 'actions', 'expectedresult', 'expected',
        'preconditions', 'precondition', 'jiraticket', 'jira', 'testcaseid', 'caseid'
      ];

      for (let r = 0; r < Math.min(15, rawRows.length); r++) {
        const row = rawRows[r];
        if (!Array.isArray(row)) continue;
        const matches = row.filter((cell: any) => {
          if (!cell) return false;
          const str = String(cell).toLowerCase().replace(/[\s\-_]/g, '');
          return recognizedKeywords.some((kw) => str.includes(kw));
        }).length;

        if (matches >= 2) {
          headerRowIndex = r;
          break;
        }
      }

      // Fallback if keyword threshold not met: first row with multiple non-empty cells
      if (headerRowIndex === -1) {
        headerRowIndex = rawRows.findIndex((r) => Array.isArray(r) && r.filter((c) => c !== '').length >= 2);
        if (headerRowIndex === -1) headerRowIndex = 0;
      }

      const headers = (rawRows[headerRowIndex] || []).map((h: any) => String(h || '').trim());

      // 2. Convert data rows into objects with column headers
      const json: any[] = [];
      for (let r = headerRowIndex + 1; r < rawRows.length; r++) {
        const rowArr = rawRows[r];
        if (!Array.isArray(rowArr) || rowArr.every((c) => c === '' || c === null || c === undefined)) {
          continue; // skip blank row
        }
        const obj: Record<string, any> = {};
        let hasContent = false;
        headers.forEach((h, cIdx) => {
          if (h && rowArr[cIdx] !== undefined) {
            obj[h] = rowArr[cIdx];
            if (String(rowArr[cIdx]).trim() !== '') hasContent = true;
          }
        });
        if (hasContent) {
          json.push(obj);
        }
      }

      const caseMap = new Map<string, ParsedCase>();
      let lastCaseKey: string | null = null;
      
      const hasStepColumn = json.length > 0 && Object.keys(json[0]).some(k => {
        const norm = k.toLowerCase().replace(/[\s\-_]/g, '');
        return ['step', 'teststeps', 'steps', 'stepdescription', 'descriptionofstep', 'teststep', 'action', 'actions'].includes(norm);
      });

      json.forEach((row, index) => {
        const testCaseIdVal = getValueByPossibleKeys(row, [
          'Test Case ID', 'test_case_id', 'Case ID', 'case_id', 'TC ID', 'tc_id', 'ID', 'id'
        ]);
        const testCaseId = testCaseIdVal ? testCaseIdVal.toString().trim() : '';

        const testScenarioIdVal = getValueByPossibleKeys(row, [
          'Test Scenario ID', 'test_scenario_id', 'Scenario ID', 'scenario_id', 'TS ID', 'ts_id'
        ]);
        const testScenarioId = testScenarioIdVal ? testScenarioIdVal.toString().trim() : '';

        const jiraTicketVal = getValueByPossibleKeys(row, [
          'Jira Ticket', 'jira_ticket', 'Jira', 'jira', 'Ticket', 'ticket', 'Issue', 'issue'
        ]);
        const jiraTicket = jiraTicketVal ? jiraTicketVal.toString().trim() : '';

        const titleVal = getValueByPossibleKeys(row, [
          'Test Case', 'test_case', 'Title', 'title', 'Case Title', 'case_title', 
          'Test Case Name', 'test_case_name', 'Scenario Title', 'scenario_title',
          'Test Scenario Title', 'test_scenario_title', 'Case', 'case', 'Name', 'name'
        ]) || (testCaseId ? `Test Case ${testCaseId}` : undefined);

        const stepTextVal = getValueByPossibleKeys(row, [
          'Step', 'step', 'Test Steps', 'test_steps', 'Steps', 'steps',
          'Step Description', 'step_description', 'Description of Step', 'description_of_step',
          'Test Step', 'test_step', 'Action', 'action', 'Actions', 'actions'
        ]);
        const stepText = stepTextVal ? stepTextVal.toString().trim() : '';

        const expectedResultVal = getValueByPossibleKeys(row, [
          'Expected Result', 'expected_result', 'Expected Results', 'expected_results',
          'Expected', 'expected', 'Expected Outcome', 'expected_outcome'
        ]);
        const expectedResult = expectedResultVal ? expectedResultVal.toString().trim() : '';

        const dataVal = getValueByPossibleKeys(row, [
          'Data', 'data', 'Test Data', 'test_data', 'Inputs', 'inputs', 'Input', 'input'
        ]);
        const dataField = dataVal ? dataVal.toString().trim() : '';

        // If row has no title but has step, and we have a previous case, append as a sub-step
        if (!titleVal && stepText && lastCaseKey && caseMap.has(lastCaseKey)) {
          const tc = caseMap.get(lastCaseKey)!;
          tc.steps.push({
            order: tc.steps.length + 1,
            step: stepText,
            expectedResult,
            data: dataField,
          });
          return;
        }

        if (!titleVal && !testCaseId) return; // Skip non-case rows
        const title = (titleVal || `Test Case ${testCaseId}`).toString().trim();

        const mapKey = hasStepColumn ? (testCaseId ? `${testCaseId}_${title}` : `${title}_${index}`) : `${title}_row_${index}`;
        lastCaseKey = mapKey;

        if (!caseMap.has(mapKey)) {
          // Resolve module Id from Test Scenario or Module column
          const moduleNameVal = getValueByPossibleKeys(row, [
            'Test Scenario', 'test_scenario', 'Module', 'module', 'Folder', 'folder', 'Section', 'section',
            'Module Name', 'module_name', 'Scenario', 'scenario'
          ]);
          const moduleName = moduleNameVal ? moduleNameVal.toString().trim() : null;
          let moduleId = null;
          if (moduleName) {
            const mod = modules.find((m: any) => m.name.toLowerCase() === moduleName.toLowerCase());
            if (mod) moduleId = mod.id;
          }

          const tagsStrVal = getValueByPossibleKeys(row, [
            'Tags', 'tags', 'Labels', 'labels', 'Tag', 'tag', 'Label', 'label'
          ]);
          const tagsStr = tagsStrVal ? tagsStrVal.toString().trim() : '';
          const rawTags = tagsStr ? tagsStr.split(/[,;\n]/).map((t: string) => t.trim()).filter(Boolean) : [];
          // Filter out raw IDs, row numbers, and code patterns to prevent tag spamming
          const tags = rawTags
            .filter((t: string) => !/^[A-Z]{2,}-[A-Z0-9\-_]+$/i.test(t) && !/^(TC|ID|CASE|ROW)[\-_0-9]+/i.test(t) && t.length < 30)
            .map((t: string) => t.toLowerCase())
            .slice(0, 4);

          const descriptionVal = getValueByPossibleKeys(row, [
            'Description', 'description', 'Desc', 'desc', 'Case Description', 'case_description', 'Details', 'details', 'Summary', 'summary'
          ]);
          
          let description = descriptionVal ? descriptionVal.toString().trim() : '';
          if (!description && jiraTicket && jiraTicket.startsWith('http')) {
            description = `Jira Ticket: ${jiraTicket}`;
          }

          const preConditionsVal = getValueByPossibleKeys(row, [
            'Pre Conditions', 'pre_conditions', 'Pre-conditions', 'pre-conditions',
            'Preconditions', 'preconditions', 'Pre-condition', 'pre-condition',
            'Precondition', 'precondition', 'Pre Condition', 'pre_condition'
          ]);
          const preConditions = preConditionsVal ? preConditionsVal.toString().trim() : '';

          const postConditionsVal = getValueByPossibleKeys(row, [
            'Post Conditions', 'post_conditions', 'Post-conditions', 'post-conditions',
            'Postconditions', 'postconditions', 'Post-condition', 'post-condition',
            'Postcondition', 'postcondition', 'Post Condition', 'post_condition'
          ]);
          const postConditions = postConditionsVal ? postConditionsVal.toString().trim() : '';

          const priorityVal = getValueByPossibleKeys(row, [
            'Priority', 'priority', 'Severity', 'severity', 'Prio', 'prio'
          ]);
          const priorityRaw = priorityVal ? priorityVal.toString().trim() : '';
          const priority = predictPriority(title, priorityRaw);

          const customFields: Record<string, any> = {};
          const severityVal = getValueByPossibleKeys(row, ['Severity', 'severity']);
          if (severityVal) {
            customFields.severity = severityVal.toString().trim();
          }
          const customTypeVal = getValueByPossibleKeys(row, ['Testing Type', 'Test Type', 'testing_type', 'test_type', 'Category', 'category']);
          if (customTypeVal) {
            customFields.testing_type = customTypeVal.toString().trim();
          }

          const typeVal = getValueByPossibleKeys(row, [
            'Type', 'type', 'Case Type', 'case_type', 'Scenario Type', 'scenario_type'
          ]);
          const typeRaw = typeVal ? typeVal.toString().trim() : '';
          const type = predictType(title, stepText ? [stepText] : [], typeRaw);

          const defaultStatus = importStatus;
          caseMap.set(mapKey, {
            _id: `case_${index}`,
            title,
            description,
            preConditions,
            postConditions,
            priority,
            type,
            status: defaultStatus,
            tags,
            customFields,
            moduleName,
            moduleId,
            steps: [],
            selected: true,
            expanded: false
          });
        }

        const tc = caseMap.get(mapKey)!;
        
        if (stepText) {
          tc.steps.push({
            order: tc.steps.length + 1,
            step: stepText,
            expectedResult,
            data: dataField,
          });
        } else if (!hasStepColumn) {
           let synthesizedStep = 'Perform scenario actions.';
           if (tc.description) {
             synthesizedStep = tc.description.replace(/\n/g, ', ');
           }
           tc.steps.push({
             order: tc.steps.length + 1,
             step: synthesizedStep,
             expectedResult,
             data: dataField,
           });
        }
      });

      const casesArray = Array.from(caseMap.values());

      // Duplicate detection: same title twice in the file, or a case that
      // already exists in the project. Duplicates stay visible but start
      // deselected so a CSV import never silently doubles the repository.
      const normalizeTitle = (value: string) =>
        String(value || '').toLowerCase().replace(/\s+/g, ' ').replace(/[—–-]/g, '-').trim();
      const seenTitles = new Map<string, number>();
      casesArray.forEach((c, index) => {
        const key = normalizeTitle(c.title);
        const first = seenTitles.get(key);
        if (first !== undefined) {
          (c as any).duplicateOf = casesArray[first]?._id || `row ${first + 1}`;
          (c as any).duplicateReason = 'Same title earlier in this file';
          c.selected = false;
        } else {
          seenTitles.set(key, index);
        }
      });

      setParsedCases(casesArray.map(c => ({ ...c, _originalCase: JSON.parse(JSON.stringify(c)) })));

      try {
        const existing = await findExistingCaseTitlesAction(
          projectId,
          casesArray.map((c) => c.title)
        );
        if (existing.length > 0) {
          const byTitle = new Map(existing.map((e) => [normalizeTitle(e.title), e]));
          setParsedCases((prev) =>
            prev.map((c) => {
              const hit = byTitle.get(normalizeTitle(c.title));
              if (!hit) return c;
              return {
                ...c,
                selected: false,
                duplicateOf: `${hit.displayId}`,
                duplicateReason: 'Already in this project',
              } as any;
            })
          );
        }
      } catch {
        // Duplicate detection is best-effort; the import itself is unaffected.
      }
    } catch (error) {
      logger.error('Failed to parse imported test cases file', {
        component: 'ImportTestCasesDialog',
        action: 'parseFile',
        projectId,
        error,
      });
      toast.error('Failed to parse Excel file. Please ensure it is correctly formatted.');
    } finally {
      setIsParsing(false);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      setFile(files[0]);
      parseFile(files[0]);
    }
  };

  const toggleSelectAll = (checked: boolean) => {
    setParsedCases(parsedCases.map(c => ({ ...c, selected: checked })));
  };

  const toggleSelectCase = (id: string, checked: boolean) => {
    setParsedCases(parsedCases.map(c => c._id === id ? { ...c, selected: checked } : c));
  };

  const toggleExpandCase = (id: string) => {
    setParsedCases(parsedCases.map(c => c._id === id ? { ...c, expanded: !c.expanded } : c));
  };

  const handleImport = async () => {
    const selectedCases = parsedCases.filter(c => c.selected);
    if (selectedCases.length === 0) {
      toast.error('No test cases selected for import');
      return;
    }

    if (isCreatingNewSuite && !newSuiteName.trim()) {
      toast.error('Please enter a name for the new test suite');
      return;
    }

    setIsImporting(true);
    try {
      let activeModules = [...modules];

      // If 'auto' module mode is selected, check for unmapped module names from the sheet and auto-create them!
      const moduleNameToIdMap = new Map<string, string>();
      activeModules.forEach((m: any) => {
        moduleNameToIdMap.set(m.name.toLowerCase().trim(), m.id);
      });

      if (selectedModuleOption === 'auto') {
        const unmappedNames = new Set<string>();
        selectedCases.forEach((c) => {
          if (!c.moduleId && c.moduleName && c.moduleName.trim()) {
            const norm = c.moduleName.toLowerCase().trim();
            if (!moduleNameToIdMap.has(norm)) {
              unmappedNames.add(c.moduleName.trim());
            }
          }
        });

        for (const name of Array.from(unmappedNames)) {
          try {
            const created = await createModuleAction({
              projectId,
              name,
            });
            activeModules.push(created);
            moduleNameToIdMap.set(name.toLowerCase().trim(), created.id);
          } catch (e) {
            // silent fallback
          }
        }
        if (setModules && unmappedNames.size > 0) {
          setModules(activeModules);
        }
      }

      // Enforce strict title uniqueness among imported cases
      const uniqueSelectedCases: any[] = [];
      const seenTitles = new Set<string>();

      cases.forEach((c: any) => {
        if (c.title) seenTitles.add(c.title.trim().toLowerCase());
      });

      selectedCases.forEach(c => {
        const baseTitle = c.title.trim();
        let titleCandidate = baseTitle;
        let counter = 1;
        while (seenTitles.has(titleCandidate.toLowerCase())) {
          titleCandidate = `${baseTitle} (${counter})`;
          counter++;
        }
        seenTitles.add(titleCandidate.toLowerCase());
        uniqueSelectedCases.push({
          ...c,
          title: titleCandidate
        });
      });

      const casesToImport = uniqueSelectedCases.map(c => {
        let finalModuleId: string | null = null;
        if (selectedModuleOption === 'none') {
          finalModuleId = null;
        } else if (selectedModuleOption !== 'auto') {
          finalModuleId = selectedModuleOption;
        } else if (c.moduleId) {
          finalModuleId = c.moduleId;
        } else if (c.moduleName && moduleNameToIdMap.has(c.moduleName.toLowerCase().trim())) {
          finalModuleId = moduleNameToIdMap.get(c.moduleName.toLowerCase().trim())!;
        }

        const customTagsList = importTagsInput.split(',').map((t) => t.trim()).filter(Boolean);
        const ticketKeyLabel = importTicketKey.trim() ? [`ticket:${importTicketKey.trim().toUpperCase()}`] : [];
        const mergedTags = Array.from(new Set([
          ...(c.tags || []),
          ...customTagsList,
          ...(importTicketKey.trim() ? [importTicketKey.trim().toUpperCase()] : []),
        ]));

        return {
          title: c.title,
          description: c.description,
          preConditions: c.preConditions,
          postConditions: c.postConditions,
          priority: c.priority,
          type: c.type,
          status: c.status,
          tags: mergedTags,
          labels: ticketKeyLabel,
          moduleId: finalModuleId,
          scenarioType: c.scenarioType,
          customFields: c.customFields || {},
          steps: c.steps,
          aiGenerated: true
        };
      });

      const imported = await importTestCasesAction({
        projectId,
        suiteId: selectedSuiteId !== 'none' && !isCreatingNewSuite ? selectedSuiteId : undefined,
        newSuiteName: isCreatingNewSuite && newSuiteName.trim() ? newSuiteName.trim() : undefined,
        cases: casesToImport
      });

      // If a new suite was created, add it to suites in local state
      if (imported.length > 0 && imported[0].createdSuite && setSuites) {
        const createdSuite = imported[0].createdSuite;
        const createdSuiteCases = imported.map((c: any, idx: number) => ({
          suite_id: createdSuite.id,
          test_case_id: c.id,
          order_index: idx + 1,
          test_case: c,
        }));
        setSuites([...suites, {
          id: createdSuite.id,
          project_id: projectId,
          projectId,
          name: createdSuite.name,
          type: 'regression',
          tags: ['REGRESSION'],
          created_at: new Date().toISOString(),
          createdAt: new Date().toISOString(),
          suite_cases: createdSuiteCases,
          caseCount: imported.length,
        }]);
      } else if (imported.length > 0 && selectedSuiteId !== 'none' && setSuites) {
        setSuites(suites.map((s: any) => {
          if (s.id === selectedSuiteId) {
            const newSuiteCases = imported.map((c: any, idx: number) => ({
              suite_id: s.id,
              test_case_id: c.id,
              order_index: (s.suite_cases?.length || 0) + idx + 1,
              test_case: c,
            }));
            return {
              ...s,
              suite_cases: [...(s.suite_cases || []), ...newSuiteCases],
              caseCount: (s.caseCount || 0) + imported.length,
            };
          }
          return s;
        }));
      }

      // Update local state
      const newCases = [...cases, ...imported];
      setCases(newCases);
      
      const suiteMsg = isCreatingNewSuite && newSuiteName.trim() 
        ? ` and added to new suite "${newSuiteName.trim()}"`
        : (selectedSuiteId !== 'none' ? ` and added to suite "${suites.find((s: any) => s.id === selectedSuiteId)?.name || 'selected suite'}"` : '');

      toast.success(`Successfully imported ${imported.length} test cases${suiteMsg}!`);
      handleOpenChange(false);
      onSuccess?.();
    } catch (error: any) {
      logger.error('Test case import failed', {
        component: 'ImportTestCasesDialog',
        action: 'handleImport',
        projectId,
        error,
      });
      toast.error(error?.message || 'Failed to import test cases');
    } finally {
      setIsImporting(false);
    }
  };

  const selectedCount = parsedCases.filter(c => c.selected).length;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] !flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            Import Test Cases
            <span className="inline-flex items-center gap-1 text-[11px] font-normal bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 border border-indigo-200/30 px-2 py-0.5 rounded-full">
              <Sparkles className="h-3 w-3" /> Powered by AI
            </span>
          </DialogTitle>
          <DialogDescription>
            Upload an Excel file (.xlsx / .xls) or a CSV to import test cases in bulk. 
            Synonyms are automatically mapped (e.g. "Test Case" or "Test Scenario" to Title; "Test Steps" to Step), and AI will predict priorities and tags in the background.
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col py-4 min-h-0">
          {!file ? (
            <div 
              className="border-2 border-dashed border-border rounded-lg flex flex-col items-center justify-center p-12 text-center flex-1 cursor-pointer hover:bg-muted/30 transition-colors"
              onClick={() => fileInputRef.current?.click()}
            >
              <Upload className="h-10 w-10 text-muted-foreground mb-4" />
              <h3 className="font-medium mb-1">Click to upload a file</h3>
              <p className="text-sm text-muted-foreground">.xlsx, .xls or .csv</p>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  const header = [
                    'Title',
                    'Priority',
                    'Type',
                    'Status',
                    'Module',
                    'Tags',
                    'Preconditions',
                    'Step',
                    'Data',
                    'Expected Result',
                  ];
                  const example = [
                    'Login with a valid email',
                    'P1',
                    'Manual',
                    'Draft',
                    'Authentication',
                    'auth,smoke',
                    'A verified account exists',
                    'Enter the email and password, then submit',
                    'user@example.com / Passw0rd!',
                    'The dashboard is shown',
                  ];
                  const escape = (value: string) => `"${value.replace(/"/g, '""')}"`;
                  const csv = [header, example]
                    .map((row) => row.map(escape).join(','))
                    .join('\n');
                  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = 'test-cases-template.csv';
                  link.click();
                  URL.revokeObjectURL(url);
                }}
                className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline cursor-pointer"
              >
                <FileText className="h-3.5 w-3.5" />
                Download CSV template
              </button>
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept=".xlsx, .xls, .csv, text/csv"
                className="hidden"
              />
            </div>
          ) : isParsing ? (
            <div className="flex-1 flex items-center justify-center">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
              <span className="ml-3">Parsing file...</span>
            </div>
          ) : (
            <div className="flex flex-col h-full min-h-0">
              <div className="flex items-center justify-between mb-4 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="h-10 w-10 bg-primary/10 text-primary rounded-lg flex items-center justify-center">
                    <CheckCircle2 className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-medium text-sm flex items-center gap-2">
                      {file.name}
                      {isAiRefining && (
                        <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-400 border border-indigo-200/50 dark:border-indigo-900/50 animate-pulse">
                          <Loader2 className="h-2.5 w-2.5 animate-spin text-indigo-500" />
                          AI mapping...
                        </span>
                      )}
                    </h3>
                    <p className="text-xs text-muted-foreground">{parsedCases.length} cases found</p>                  </div>
                </div>
                <Button variant="outline" size="sm" onClick={resetState}>
                  <X className="h-4 w-4 mr-1" /> Remove
                </Button>
              </div>

              {/* Organization & Configuration Bar */}
              <div className="p-3.5 rounded-xl border border-border/60 bg-muted/20 mb-3 text-xs shrink-0 space-y-3">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {/* Target Module */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-foreground font-semibold">
                      <Folder className="h-3.5 w-3.5 text-primary" />
                      <span>Target Module:</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <ModuleSelect
                        modules={modules}
                        value={selectedModuleOption}
                        allowAutoDetect
                        noneLabel="No Module (Root)"
                        autoLabel="✨ Auto-detect from Sheet (Default)"
                        onInlineCreate={async (name) => {
                          const createdMod = await createModuleAction({ projectId, name });
                          if (setModules) setModules([...(modules || []), createdMod]);
                          setSelectedModuleOption(createdMod.id);
                          setParsedCases((prev) => prev.map((c) => ({ ...c, moduleId: createdMod.id })));
                          return createdMod.id;
                        }}
                        onChange={(val) => {
                          setSelectedModuleOption(val);
                          if (val === 'none') {
                            setParsedCases((prev) => prev.map((c) => ({ ...c, moduleId: null })));
                          } else if (val !== 'auto') {
                            setParsedCases((prev) => prev.map((c) => ({ ...c, moduleId: val })));
                          }
                        }}
                      />
                    </div>
                  </div>

                  {/* Target Suite */}
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 text-foreground font-semibold">
                      <Layers className="h-3.5 w-3.5 text-primary" />
                      <span>Target Suite:</span>
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <select
                        value={isCreatingNewSuite ? 'new_suite' : selectedSuiteId}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === 'new_suite') {
                            setIsCreatingNewSuite(true);
                            setSelectedSuiteId('none');
                          } else {
                            setIsCreatingNewSuite(false);
                            setSelectedSuiteId(val);
                          }
                        }}
                        className="h-8 rounded-lg border border-border/50 bg-background px-2.5 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full cursor-pointer"
                      >
                        <option value="none">No Suite (Default)</option>
                        {suites.map((s: any) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                        <option value="new_suite">+ Create New Suite...</option>
                      </select>

                      {isCreatingNewSuite && (
                        <Input
                          value={newSuiteName}
                          onChange={(e) => setNewSuiteName(e.target.value)}
                          placeholder="Enter new suite name (e.g. Smoke Suite)"
                          className="h-8 text-xs w-full"
                          autoFocus
                        />
                      )}
                    </div>
                  </div>
                </div>

                {/* Initial Status Selector */}
                <div className="flex flex-wrap items-center gap-3 pt-2.5 border-t border-border/40 text-xs">
                  <span className="font-semibold text-foreground">Initial Status:</span>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="importStatusRadio"
                      value="active"
                      checked={importStatus === 'active'}
                      onChange={() => {
                        setImportStatus('active');
                        setParsedCases((prev) => prev.map((c) => ({ ...c, status: 'active' })));
                      }}
                      className="text-primary"
                    />
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">Active (Ready to run)</span>
                  </label>
                  <label className="inline-flex items-center gap-1.5 cursor-pointer">
                    <input
                      type="radio"
                      name="importStatusRadio"
                      value="draft"
                      checked={importStatus === 'draft'}
                      onChange={() => {
                        setImportStatus('draft');
                        setParsedCases((prev) => prev.map((c) => ({ ...c, status: 'draft' })));
                      }}
                      className="text-primary"
                    />
                    <span className="text-muted-foreground font-medium">Draft (Unpublished / In review)</span>
                  </label>
                </div>

                {/* Custom Tags & Linked Ticket Key */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2.5 border-t border-border/40 text-xs">
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-muted-foreground flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      <span>Attach Tags (comma-separated)</span>
                    </label>
                    <Input
                      placeholder="e.g. sprint-24, smoke, v2.5"
                      value={importTagsInput}
                      onChange={(e) => setImportTagsInput(e.target.value)}
                      className="h-8 text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-semibold text-blue-400 flex items-center gap-1">
                      <Tag className="h-3 w-3" />
                      <span>Link to InkaBoard / Jira Ticket</span>
                    </label>
                    <Input
                      placeholder="e.g. INK-101 or JIRA-42"
                      value={importTicketKey}
                      onChange={(e) => setImportTicketKey(e.target.value)}
                      className="h-8 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-2 mb-2 px-1 shrink-0">
                <input
                  type="checkbox"
                  checked={selectedCount === parsedCases.length && parsedCases.length > 0}
                  onChange={(e) => toggleSelectAll(e.target.checked)}
                  className="rounded border-border text-primary focus:ring-primary"
                />
                <span className="text-sm font-medium">Select All</span>
                <div className="ml-auto inline-flex items-center rounded-lg border border-indigo-200 dark:border-indigo-900/50 bg-background overflow-hidden shadow-2xs">
                  <button
                    type="button"
                    onClick={() => {
                      const casesToEnrich = parsedCases.filter(c => c.selected);
                      if (casesToEnrich.length > 0) {
                        triggerAiEnrichment(casesToEnrich, '');
                      } else {
                        toast.error("Please select at least one test case to enhance");
                      }
                    }}
                    disabled={isAiRefining}
                    className="inline-flex items-center gap-1.5 h-8 pl-3 pr-2 text-xs font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer disabled:opacity-50"
                    title="Bulk Enhance Selected Cases with AI (Auto)"
                  >
                    <Sparkles className="h-3.5 w-3.5 shrink-0" />
                    <span>Bulk Enhance AI</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowCustomAiPrompt((prev) => !prev)}
                    disabled={isAiRefining}
                    className={cn(
                      'inline-flex items-center gap-1 h-8 px-2 border-l border-indigo-200 dark:border-indigo-900/50 text-[11px] font-medium text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/50 transition-colors cursor-pointer disabled:opacity-50',
                      showCustomAiPrompt && 'bg-indigo-500/15'
                    )}
                    title="Customize AI prompt or column mapping hints"
                  >
                    <span>{showCustomAiPrompt ? 'Custom' : 'Auto'}</span>
                  </button>
                </div>
              </div>

              {showCustomAiPrompt && (
                <div className="mb-2.5 p-2.5 rounded-xl border border-indigo-500/30 bg-indigo-500/5 space-y-2 shrink-0">
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="text-[11px] font-semibold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                      <Sparkles className="h-3 w-3" />
                      <span>Custom Prompt / Sheet Column Hints</span>
                    </span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {[
                        'Keep original wording, only add expected results',
                        'Expand 1-liner rows into 3–4 steps',
                        'Use {parameter} placeholders for data columns',
                      ].map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => setCustomAiPrompt(preset)}
                          className="text-[10px] px-2 py-0.5 rounded-full border border-indigo-500/25 bg-background/80 hover:bg-indigo-500/10 text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Input
                      value={customAiPrompt}
                      onChange={(e) => setCustomAiPrompt(e.target.value)}
                      placeholder="Custom instructions or column mapping hints (e.g. Column C is feature flag state)..."
                      disabled={isAiRefining}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          const casesToEnrich = parsedCases.filter(c => c.selected);
                          if (casesToEnrich.length > 0) {
                            triggerAiEnrichment(casesToEnrich, customAiPrompt);
                          } else {
                            toast.error("Please select at least one test case to enhance");
                          }
                        }
                      }}
                      className="h-8 text-xs flex-1 bg-background"
                    />
                    <Button
                      type="button"
                      size="sm"
                      disabled={isAiRefining}
                      onClick={() => {
                        const casesToEnrich = parsedCases.filter(c => c.selected);
                        if (casesToEnrich.length > 0) {
                          triggerAiEnrichment(casesToEnrich, customAiPrompt);
                        } else {
                          toast.error("Please select at least one test case to enhance");
                        }
                      }}
                      className="h-8 px-3 text-xs bg-indigo-600 hover:bg-indigo-700 text-white font-semibold cursor-pointer gap-1 shrink-0"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Enhance Selected</span>
                    </Button>
                  </div>
                </div>
              )}

              <div className="flex-1 overflow-y-auto border border-border/50 rounded-md">
                {(() => {
                  const duplicates = parsedCases.filter((c: any) => Boolean(c.duplicateReason));
                  if (duplicates.length === 0) return null;
                  return (
                    <div className="flex items-center justify-between gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-2">
                      <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-amber-700 dark:text-amber-300">
                        <AlertTriangle className="h-3.5 w-3.5" />
                        {duplicates.length} row{duplicates.length === 1 ? '' : 's'} look like duplicates and
                        {' '}start deselected
                      </span>
                      <button
                        type="button"
                        onClick={() => setParsedCases((prev) => prev.map((c) => ({ ...c, selected: true })))}
                        className="shrink-0 text-[11px] font-medium text-primary hover:underline cursor-pointer"
                      >
                        Select them anyway
                      </button>
                    </div>
                  );
                })()}
                {parsedCases.length === 0 ? (
                  <div className="p-8 text-center text-muted-foreground">
                    No valid test cases found in the file. Make sure the file has a "Title" or "Test Case" column.
                  </div>
                ) : (
                  <div className="divide-y divide-border/50">
                    {parsedCases.map((tc) => (
                      <div key={tc._id} className="bg-card">
                        <div className="flex items-center p-3 hover:bg-muted/30 transition-colors">
                          <input
                            type="checkbox"
                            checked={tc.selected}
                            onChange={(e) => toggleSelectCase(tc._id, e.target.checked)}
                            className="mr-3 rounded border-border text-primary focus:ring-primary"
                          />
                          <button
                            type="button"
                            onClick={() => toggleExpandCase(tc._id)}
                            className="mr-2 text-muted-foreground hover:text-foreground"
                          >
                            {tc.expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </button>
                          
                          <div className="flex-1 min-w-0 flex items-center gap-3" onClick={() => toggleExpandCase(tc._id)}>
                            <span className="font-medium text-sm truncate">{tc.title}</span>
                            {(tc as any).duplicateReason && (
                              <span
                                className="inline-flex shrink-0 items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-300"
                                title={`${(tc as any).duplicateReason} — ${(tc as any).duplicateOf || ''}`}
                              >
                                <AlertTriangle className="h-2.5 w-2.5" />
                                {(tc as any).duplicateReason}
                              </span>
                            )}
                            <PriorityBadge priority={tc.priority as any} />
                            <div className="relative shrink-0" onClick={(e) => e.stopPropagation()}>
                              <ModuleSelect
                                modules={modules}
                                value={tc.moduleId || ''}
                                allowNone
                                noneLabel={tc.moduleName ? `Auto: ${tc.moduleName}` : 'Without Module'}
                                size="sm"
                                className={cn(
                                  'max-w-[170px] truncate rounded-full',
                                  tc.moduleId
                                    ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                                    : tc.moduleName
                                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                                    : 'border-border/50 bg-muted text-muted-foreground'
                                )}
                                onInlineCreate={async (name) => {
                                  const createdMod = await createModuleAction({ projectId, name });
                                  if (setModules) setModules([...(modules || []), createdMod]);
                                  setParsedCases((prev) =>
                                    prev.map((c) => (c._id === tc._id ? { ...c, moduleId: createdMod.id } : c))
                                  );
                                  return createdMod.id;
                                }}
                                onChange={(val) => {
                                  const newModId = val || null;
                                  setParsedCases((prev) =>
                                    prev.map((c) => (c._id === tc._id ? { ...c, moduleId: newModId } : c))
                                  );
                                }}
                              />
                            </div>
                            <span className="text-xs text-muted-foreground ml-auto">
                              {tc.steps.length} step{tc.steps.length !== 1 ? 's' : ''}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            {tc.isEnriched ? (
                              <>
                                <div className="text-green-600 bg-green-50 dark:text-green-400 dark:bg-green-900/20 px-2 py-1 rounded text-xs flex items-center gap-1 font-medium">
                                  <CheckCircle2 className="h-3.5 w-3.5" /> Enriched
                                </div>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 px-2 text-muted-foreground hover:text-foreground"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (tc._originalCase) {
                                      setParsedCases(prev => prev.map(c => 
                                        c._id === tc._id ? { ...(tc._originalCase as ParsedCase), selected: c.selected, expanded: c.expanded, isEnriched: false } : c
                                      ));
                                    }
                                  }}
                                  title="Revert to original"
                                >
                                  Revert
                                </Button>
                              </>
                            ) : (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 dark:text-indigo-400 dark:hover:text-indigo-300 dark:hover:bg-indigo-950/50"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  triggerAiEnrichment([tc]);
                                }}
                                disabled={isAiRefining}
                                title="Enhance with AI"
                              >
                                <Sparkles className="h-4 w-4" />
                              </Button>
                            )}
                          </div>
                        </div>

                        {tc.expanded && (
                          <div className="pl-12 pr-4 pb-4 pt-3 bg-muted/10">
                            {tc.description && (
                              <div className="text-sm text-muted-foreground mb-4">
                                {tc.description}
                              </div>
                            )}

                            {(tc.preConditions || tc.postConditions) && (
                              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4 text-xs">
                                {tc.preConditions && (
                                  <div className="bg-card p-3 rounded border border-border/50 shadow-sm">
                                    <span className="font-semibold text-muted-foreground block mb-1">Pre-conditions:</span>
                                    <p className="whitespace-pre-line text-foreground/80 leading-relaxed">{tc.preConditions}</p>
                                  </div>
                                )}
                                {tc.postConditions && (
                                  <div className="bg-card p-3 rounded border border-border/50 shadow-sm">
                                    <span className="font-semibold text-muted-foreground block mb-1">Post-conditions:</span>
                                    <p className="whitespace-pre-line text-foreground/80 leading-relaxed">{tc.postConditions}</p>
                                  </div>
                                )}
                              </div>
                            )}
                            
                            {tc.steps.length > 0 ? (
                              <div className="border border-border/50 rounded overflow-hidden shadow-sm">
                                <table className="w-full text-xs text-left">
                                  <thead className="bg-muted/50 text-muted-foreground border-b border-border/50">
                                    <tr>
                                      <th className="px-3 py-2 font-semibold w-12">#</th>
                                      <th className="px-3 py-2 font-semibold w-[45%]">Step</th>
                                      <th className="px-3 py-2 font-semibold w-[35%]">Expected Result</th>
                                      <th className="px-3 py-2 font-semibold">Test Data</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-border/50 bg-card/50">
                                    {tc.steps.map((step, idx) => (
                                      <tr key={idx} className="hover:bg-muted/10 transition-colors">
                                        <td className="px-3 py-2.5 text-muted-foreground align-top">{step.order}</td>
                                        <td className="px-3 py-2.5 text-foreground/90 font-medium leading-relaxed align-top">
                                          {step.step}
                                          {step.reusableStepId && (
                                            <div className="mt-2 inline-flex items-center gap-1 text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-600 border border-blue-400/30">
                                              <Link2 className="h-3 w-3" /> Shared
                                            </div>
                                          )}
                                        </td>
                                        <td className="px-3 py-2.5 text-foreground/80 leading-relaxed align-top">{step.expectedResult || '-'}</td>
                                        <td className="px-3 py-2.5 text-muted-foreground italic font-normal leading-relaxed align-top">{step.data || '-'}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            ) : (
                              <div className="text-xs text-muted-foreground italic">No steps defined</div>
                            )}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="mt-4">
          <Button variant="outline" onClick={() => handleOpenChange(false)}>
            Cancel
          </Button>
          <Button 
            onClick={handleImport} 
            disabled={!file || selectedCount === 0 || isImporting}
            className="gradient-btn text-white font-medium"
          >
            {isImporting
              ? 'Importing...'
              : isCreatingNewSuite && newSuiteName.trim()
              ? `Import ${selectedCount} Cases & Create Suite`
              : selectedSuiteId !== 'none'
              ? `Import ${selectedCount} Cases to Suite`
              : `Import Selected (${selectedCount})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
