"use client";

import { useParams } from 'next/navigation';
import { useProjectData } from '@/components/providers/ProjectDataProvider';
import { cn } from '@/lib/utils';
import { useRouter } from 'next/navigation';
import { usePathname } from 'next/navigation';
import { motion } from 'framer-motion';
import { MOTION } from '@/lib/motion';

export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const { slug } = params as Record<string, string>;
  const router = useRouter();
  const pathname = usePathname();
  const { project } = useProjectData();

  if (!project) return null;

const tabs = [
  { label: 'General', tab: 'general' },
  { label: 'Configuration', tab: 'configuration' },
  { label: 'Members', tab: 'members' },
  { label: 'Issue Tracker', tab: 'tracker' },
  { label: 'Notifications', tab: 'notifications' },
  { label: 'Developer & API', tab: 'developer' },
  { label: 'AI', tab: 'ai' },
];

  const activeTab = pathname.includes('/settings/tracker') || pathname.includes('/settings/integrations')
    ? 'tracker'
    : pathname.includes('/settings/developer') || pathname.includes('/settings/connections') || pathname.includes('/settings/api')
    ? 'developer'
    : pathname.includes('/settings/configuration') || pathname.includes('/settings/releases')
    ? 'configuration'
    : tabs.find(t => pathname.includes(`/settings/${t.tab}`))?.tab || 'general';

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          <span className="font-semibold text-foreground/80 tracking-wide uppercase">{project.name}</span>
          <span className="mx-1.5 opacity-60">·</span>
          Manage how this project works
        </p>
      </div>

      <div className="border-b border-border/50">
        <nav className="flex gap-6 overflow-x-auto scrollbar-none">
          {tabs.map((tab) => (
            <button
              key={tab.tab}
              onClick={() => router.push(`/p/${slug}/settings/${tab.tab}`)}
              className={cn(
                'relative py-2.5 text-xs sm:text-sm font-medium transition-colors cursor-pointer whitespace-nowrap',
                activeTab === tab.tab
                  ? 'text-foreground'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              {tab.label}
              {activeTab === tab.tab && (
                <motion.div
                  layoutId="settings-nav-tab-indicator"
                  className="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-full"
                  transition={MOTION.spring.pill}
                />
              )}
            </button>
          ))}
        </nav>
      </div>

      <div>
        {children}
      </div>
    </div>
  );
}