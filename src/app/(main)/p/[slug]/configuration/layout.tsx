"use client";

import { useParams, useRouter, usePathname } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { cn } from '@/lib/utils';
import {
  Layers,
  Code2,
  Database,
  Globe,
  SlidersHorizontal,
  MonitorSmartphone,
  Tags
} from 'lucide-react';

export default function ConfigurationLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const router = useRouter();
  const pathname = usePathname();
  const { project } = useProjectData();

  if (!project) return null;

  const tabs = [
    { label: 'Step Library', tab: 'step-library', icon: Layers, desc: 'Shared steps and reusable sequences' },
    { label: 'Custom Fields', tab: 'fields', icon: Tags, desc: 'Custom properties and fields across test cases' },
    { label: 'Variables', tab: 'variables', icon: Code2, desc: 'Global & local secret/plain variables' },
    { label: 'Parameters', tab: 'datasets', icon: Database, desc: 'Data-driven test datasets & parameters' },
    { label: 'Environments', tab: 'environments', icon: Globe, desc: 'Dev, Staging, and Production environments' },
    { label: 'Execution Targets', tab: 'targets', icon: MonitorSmartphone, desc: 'Browsers, OS, mobile apps & runtime properties' },
  ];

  const activeTab = tabs.find((t) => pathname.includes(`/configuration/${t.tab}`))?.tab || 'step-library';

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto w-full">
      <div className="flex items-center justify-between flex-wrap gap-4">
        <div>
          <div className="flex items-center gap-2">
            <div className="p-1.5 rounded-xl bg-primary/10 text-primary border border-primary/20">
              <SlidersHorizontal className="h-5 w-5" />
            </div>
            <h1 className="text-xl font-bold text-foreground">Configuration Center</h1>
          </div>
          <p className="text-xs text-muted-foreground mt-1">
            Manage reusable step libraries, execution parameters, environments, variables, and runtime target devices.
          </p>
        </div>
      </div>

      <div className="border-b border-border/50">
        <nav className="flex gap-4 sm:gap-6 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.tab;
            return (
              <button
                key={tab.tab}
                onClick={() => router.push(`/p/${slug}/configuration/${tab.tab}`)}
                className={cn(
                  'relative py-3.5 text-xs font-semibold transition-colors flex items-center gap-2 shrink-0 cursor-pointer',
                  isActive
                    ? 'text-primary'
                    : 'text-muted-foreground hover:text-foreground'
                )}
              >
                <Icon className={cn("h-4 w-4", isActive ? "text-primary" : "text-muted-foreground")} />
                <span>{tab.label}</span>
                {isActive && (
                  <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full shadow-xs" />
                )}
              </button>
            );
          })}
        </nav>
      </div>

      <div>{children}</div>
    </div>
  );
}
