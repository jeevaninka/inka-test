"use client";

import { useState, useEffect, type ReactNode } from 'react';
import { useParams } from 'next/navigation';
import { Sidebar, type WorkspaceState } from '@/components/layout/Sidebar';
import { TopBar } from '@/components/layout/TopBar';
import { PageTransition } from '@/components/common/PageTransition';
import { cn } from '@/lib/utils';

export function ProjectLayoutShell({
  children,
  workspaceName,
  projectName,
  initialCollapsed = false,
  initialWorkspace = null,
}: {
  children: ReactNode;
  workspaceName: string;
  projectName: string;
  initialCollapsed?: boolean;
  initialWorkspace?: WorkspaceState | null;
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);

  useEffect(() => {
    const handleToggle = (e: any) => {
      setCollapsed(e.detail?.collapsed ?? false);
    };
    if (typeof window !== 'undefined') {
      setCollapsed(localStorage.getItem('inka_sidebar_collapsed') === 'true');
      const parts = window.location.pathname.split('/').filter(Boolean);
      if (parts[0] === 'p' && parts[1]) {
        localStorage.setItem('inka_last_project_slug', parts[1]);
        document.cookie = `inka_last_project_slug=${parts[1]}; path=/; max-age=31536000; SameSite=Lax`;
      }
    }
    window.addEventListener('sidebar-toggle', handleToggle);
    return () => window.removeEventListener('sidebar-toggle', handleToggle);
  }, []);

  const params = useParams();
  const slug = (params?.slug as string) || projectName.toLowerCase();

  return (
    <div className="min-h-screen bg-background">
      <Sidebar initialWorkspace={initialWorkspace} />
      <TopBar
        breadcrumbs={[
          { label: workspaceName.toUpperCase(), href: '/projects' },
          { label: projectName.toUpperCase(), href: `/p/${slug}` },
        ]}
      />
      <main className={cn("pt-14 transition-[padding-left] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]", collapsed ? "md:pl-16" : "md:pl-48")}>
        <PageTransition>
          {children}
        </PageTransition>
      </main>
    </div>
  );
}
