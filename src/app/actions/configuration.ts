'use server';

import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth.config';
import { prisma } from '@/lib/db';
import { requireProjectMember, requireProjectViewer } from '@/lib/permissions';
import { logger } from '@/lib/logger';

export interface BrowserTarget {
  id: string;
  name: string;
  icon?: string;
  versions: string[];
  defaultVersion: string;
  viewports: string[];
  defaultViewport: string;
  headless: boolean;
  enabled: boolean;
}

export interface OperatingSystemTarget {
  id: string;
  name: string;
  icon?: string;
  versions: string[];
  architectures: string[];
  enabled: boolean;
}

export interface AppTarget {
  id: string;
  name: string;
  type: 'webapp' | 'ios' | 'android' | 'desktop' | 'api';
  identifier: string; // URL, bundle ID, or package name
  environmentUrl?: string;
  buildVersion?: string;
  notes?: string;
  enabled: boolean;
}

export interface CustomExecutionProperty {
  id: string;
  key: string;
  label: string;
  type: 'select' | 'text' | 'boolean';
  options?: string[];
  defaultValue?: string;
  description?: string;
}

export interface ExecutionTargetsConfig {
  browsers: BrowserTarget[];
  operatingSystems: OperatingSystemTarget[];
  apps: AppTarget[];
  customProperties: CustomExecutionProperty[];
}

const DEFAULT_TARGETS: ExecutionTargetsConfig = {
  browsers: [
    {
      id: 'chrome',
      name: 'Google Chrome',
      versions: ['128.0', '127.0', '126.0 (Stable)', 'Latest'],
      defaultVersion: 'Latest',
      viewports: ['1920x1080 (Desktop FHD)', '1440x900 (Laptop)', '1280x720 (HD)', '390x844 (iPhone 14)'],
      defaultViewport: '1920x1080 (Desktop FHD)',
      headless: false,
      enabled: true,
    },
    {
      id: 'firefox',
      name: 'Mozilla Firefox',
      versions: ['129.0', '128.0 (ESR)', 'Latest'],
      defaultVersion: 'Latest',
      viewports: ['1920x1080 (Desktop FHD)', '1440x900 (Laptop)'],
      defaultViewport: '1920x1080 (Desktop FHD)',
      headless: false,
      enabled: true,
    },
    {
      id: 'safari',
      name: 'Apple Safari',
      versions: ['17.5', '17.0', '18.0 (Beta)'],
      defaultVersion: '17.5',
      viewports: ['1440x900 (MacBook)', '1920x1080 (iMac)', '390x844 (Mobile Safari)'],
      defaultViewport: '1440x900 (MacBook)',
      headless: false,
      enabled: true,
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      versions: ['127.0', 'Latest (Chromium)'],
      defaultVersion: 'Latest (Chromium)',
      viewports: ['1920x1080 (Desktop FHD)'],
      defaultViewport: '1920x1080 (Desktop FHD)',
      headless: false,
      enabled: true,
    },
    {
      id: 'webkit',
      name: 'Mobile WebKit (Playwright / Appium)',
      versions: ['Latest'],
      defaultVersion: 'Latest',
      viewports: ['390x844 (iPhone 14)', '412x915 (Pixel 7)'],
      defaultViewport: '390x844 (iPhone 14)',
      headless: true,
      enabled: false,
    },
  ],
  operatingSystems: [
    {
      id: 'macos',
      name: 'macOS',
      versions: ['14.5 Sonoma', '15.0 Sequoia (Beta)', '13.6 Ventura'],
      architectures: ['Apple Silicon (ARM64)', 'Intel (x86_64)'],
      enabled: true,
    },
    {
      id: 'windows',
      name: 'Windows',
      versions: ['Windows 11 (23H2)', 'Windows 10 (22H2)', 'Windows Server 2022'],
      architectures: ['x64', 'ARM64'],
      enabled: true,
    },
    {
      id: 'linux',
      name: 'Ubuntu / Linux',
      versions: ['Ubuntu 24.04 LTS', 'Ubuntu 22.04 LTS', 'Debian 12 Bookworm'],
      architectures: ['x86_64', 'aarch64'],
      enabled: true,
    },
    {
      id: 'ios',
      name: 'Apple iOS',
      versions: ['iOS 17.5', 'iOS 18.0 (Beta)', 'iOS 16.7'],
      architectures: ['arm64'],
      enabled: true,
    },
    {
      id: 'android',
      name: 'Google Android',
      versions: ['Android 14 (API 34)', 'Android 13 (API 33)', 'Android 15 (API 35)'],
      architectures: ['arm64-v8a', 'x86_64'],
      enabled: true,
    },
  ],
  apps: [
    {
      id: 'app-webapp',
      name: 'Web Application (Inka Frontend)',
      type: 'webapp',
      identifier: 'https://staging.inka.qa',
      environmentUrl: 'https://staging.inka.qa',
      buildVersion: 'v2.4.0-rc3',
      notes: 'Main web client interface running Next.js App Router',
      enabled: true,
    },
    {
      id: 'app-ios',
      name: 'InkaQA Mobile Client (iOS)',
      type: 'ios',
      identifier: 'com.inkasure.qa.ios',
      environmentUrl: 'https://testflight.apple.com/join/inkaqa',
      buildVersion: '2.4.0 (148)',
      notes: 'Internal TestFlight release build for regression test runs',
      enabled: true,
    },
    {
      id: 'app-android',
      name: 'InkaQA Mobile Client (Android)',
      type: 'android',
      identifier: 'com.inkasure.qa.android',
      environmentUrl: 'https://appdistribution.firebase.google.com',
      buildVersion: '2.4.0 (2026)',
      notes: 'Internal Firebase App Distribution APK build',
      enabled: true,
    },
    {
      id: 'app-api',
      name: 'Core Backend Gateway (REST & GraphQL API)',
      type: 'api',
      identifier: 'https://api-staging.inka.qa/v1',
      environmentUrl: 'https://api-staging.inka.qa/docs',
      buildVersion: 'build-492a',
      notes: 'Production & staging test runner API backend',
      enabled: true,
    },
  ],
  customProperties: [
    {
      id: 'network_condition',
      key: 'NETWORK_PROFILE',
      label: 'Network Emulation Profile',
      type: 'select',
      options: ['Unthrottled (LAN / WiFi)', 'Fast 4G (100Mbps)', 'Slow 3G (750Kbps)', 'Offline / Flaky'],
      defaultValue: 'Unthrottled (LAN / WiFi)',
      description: 'Simulates network speed constraints during test execution sessions.',
    },
    {
      id: 'locale_timezone',
      key: 'TEST_LOCALE',
      label: 'Locale & Timezone',
      type: 'select',
      options: ['en-US (UTC)', 'en-IN (Asia/Kolkata)', 'en-GB (Europe/London)', 'de-DE (Europe/Berlin)'],
      defaultValue: 'en-US (UTC)',
      description: 'Default localization attributes applied to headless browsers and devices.',
    },
  ],
};

export async function getExecutionTargetsAction(projectId: string): Promise<ExecutionTargetsConfig> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectViewer(projectId, userId);

  const record = await prisma.integration.findUnique({
    where: {
      project_id_provider: {
        project_id: projectId,
        provider: 'execution_targets',
      },
    },
  });

  if (!record || !record.config) {
    return DEFAULT_TARGETS;
  }

  const saved = record.config as unknown as ExecutionTargetsConfig;
  return {
    browsers: saved.browsers?.length ? saved.browsers : DEFAULT_TARGETS.browsers,
    operatingSystems: saved.operatingSystems?.length ? saved.operatingSystems : DEFAULT_TARGETS.operatingSystems,
    apps: saved.apps?.length ? saved.apps : DEFAULT_TARGETS.apps,
    customProperties: saved.customProperties?.length ? saved.customProperties : DEFAULT_TARGETS.customProperties,
  };
}

export async function saveExecutionTargetsAction(
  projectId: string,
  data: ExecutionTargetsConfig
): Promise<{ success: boolean }> {
  const session = await getServerSession(authOptions);
  if (!session?.user) throw new Error('Unauthorized');
  const userId = (session.user as any).id as number;
  await requireProjectMember(projectId, userId);

  await prisma.integration.upsert({
    where: {
      project_id_provider: {
        project_id: projectId,
        provider: 'execution_targets',
      },
    },
    create: {
      project_id: projectId,
      provider: 'execution_targets',
      config: data as any,
      enabled: true,
    },
    update: {
      config: data as any,
      last_synced_at: new Date(),
    },
  });

  logger.info('Execution targets configuration saved', {
    module: 'Configuration',
    action: 'saveExecutionTargetsAction',
    projectId,
    userId,
  });

  return { success: true };
}
