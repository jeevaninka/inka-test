"use client";

import { createContext, useContext, useState, useEffect, useRef, type ReactNode } from 'react';

interface CurrentUser {
  id: number;
  name: string;
  email: string;
  image?: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type GenericItem = any;

interface ProjectData {
  project: GenericItem | null;
  projects: GenericItem[];
  modules: GenericItem[];
  cases: GenericItem[];
  archivedCases: GenericItem[];
  customFieldDefs: GenericItem[];
  suites: GenericItem[];
  runs: GenericItem[];
  members: GenericItem[];
  currentUser: CurrentUser | null;
  userRole: 'admin' | 'tester' | 'viewer';
  canEdit: boolean;
  isAdmin: boolean;
  workspaceName?: string;
  setCases: (cases: GenericItem[]) => void;
  setArchivedCases: (cases: GenericItem[]) => void;
  setCustomFieldDefs: (defs: GenericItem[]) => void;
  setSuites: (suites: GenericItem[]) => void;
  setRuns: (runs: GenericItem[]) => void;
  setMembers: (members: GenericItem[]) => void;
  setModules: (modules: GenericItem[]) => void;
}

const EMPTY_ARRAY: GenericItem[] = [];

const ProjectDataContext = createContext<ProjectData>({
  project: null,
  projects: EMPTY_ARRAY,
  modules: EMPTY_ARRAY,
  cases: EMPTY_ARRAY,
  archivedCases: EMPTY_ARRAY,
  customFieldDefs: EMPTY_ARRAY,
  suites: EMPTY_ARRAY,
  runs: EMPTY_ARRAY,
  members: EMPTY_ARRAY,
  currentUser: null,
  userRole: 'tester',
  canEdit: true,
  isAdmin: false,
  workspaceName: 'INKA',
  setCases: () => {},
  setArchivedCases: () => {},
  setCustomFieldDefs: () => {},
  setSuites: () => {},
  setRuns: () => {},
  setMembers: () => {},
  setModules: () => {},
});

export function useProjectData() {
  return useContext(ProjectDataContext);
}

export function ProjectDataProvider({
  children,
  project,
  projects = EMPTY_ARRAY,
  currentUser,
  userRole = 'tester',
  canEdit = true,
  isAdmin = false,
  modules: initialModules = EMPTY_ARRAY,
  cases: initialCases = EMPTY_ARRAY,
  archivedCases: initialArchivedCases = EMPTY_ARRAY,
  customFieldDefs: initialCustomFieldDefs = EMPTY_ARRAY,
  suites: initialSuites = EMPTY_ARRAY,
  runs: initialRuns = EMPTY_ARRAY,
  members: initialMembers = EMPTY_ARRAY,
  workspaceName = 'INKA',
}: {
  children: ReactNode;
  project: GenericItem | null;
  projects?: GenericItem[];
  currentUser?: CurrentUser | null;
  userRole?: 'admin' | 'tester' | 'viewer';
  canEdit?: boolean;
  isAdmin?: boolean;
  modules?: GenericItem[];
  cases?: GenericItem[];
  archivedCases?: GenericItem[];
  customFieldDefs?: GenericItem[];
  suites?: GenericItem[];
  runs?: GenericItem[];
  members?: GenericItem[];
  workspaceName?: string;
}) {
  const [cases, setCases] = useState(initialCases);
  const [archivedCases, setArchivedCases] = useState(initialArchivedCases);
  const [customFieldDefs, setCustomFieldDefs] = useState(initialCustomFieldDefs);
  const [suites, setSuites] = useState(initialSuites);
  const [runs, setRuns] = useState(initialRuns);
  const [members, setMembers] = useState(initialMembers);
  const [modules, setModules] = useState(initialModules);

  const currentProjectId = project?.id;
  const prevProjectIdRef = useRef(currentProjectId);

  // Controlled sync on project switch — eliminates infinite re-render loop
  useEffect(() => {
    if (prevProjectIdRef.current !== currentProjectId) {
      prevProjectIdRef.current = currentProjectId;
      setCases(initialCases);
      setArchivedCases(initialArchivedCases);
      setCustomFieldDefs(initialCustomFieldDefs);
      setSuites(initialSuites);
      setRuns(initialRuns);
      setMembers(initialMembers);
      setModules(initialModules);
    }
  }, [currentProjectId, initialCases, initialArchivedCases, initialCustomFieldDefs, initialSuites, initialRuns, initialMembers, initialModules]);

  return (
    <ProjectDataContext.Provider
      value={{
        project,
        projects,
        modules,
        cases,
        archivedCases,
        customFieldDefs,
        suites,
        runs,
        members,
        currentUser: currentUser ?? null,
        userRole,
        canEdit,
        isAdmin,
        workspaceName,
        setCases,
        setArchivedCases,
        setCustomFieldDefs,
        setSuites,
        setRuns,
        setMembers,
        setModules,
      }}
    >
      {children}
    </ProjectDataContext.Provider>
  );
}
