import React from 'react';

/**
 * Official Slack brand logo (4-color mark)
 * Standard nominative brand asset for integrations hubs
 */
export function SlackLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 127 127"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Slack logo"
    >
      <path
        d="M27.2 80c0 7.3-5.9 13.2-13.2 13.2C6.7 93.2.8 87.3.8 80c0-7.3 5.9-13.2 13.2-13.2h13.2V80zm6.6 0c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2v33c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V80z"
        fill="#E01E5A"
      />
      <path
        d="M47 27.2c-7.3 0-13.2-5.9-13.2-13.2C33.8 6.7 39.7.8 47 .8c7.3 0 13.2 5.9 13.2 13.2v13.2H47zm0 6.6c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H14c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2H47z"
        fill="#36C5F0"
      />
      <path
        d="M99.8 47c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H99.8V47zm-6.6 0c0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V14c0-7.3 5.9-13.2 13.2-13.2 7.3 0 13.2 5.9 13.2 13.2V47z"
        fill="#2EB67D"
      />
      <path
        d="M80 99.8c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2-7.3 0-13.2-5.9-13.2-13.2V99.8H80zm0-6.6c-7.3 0-13.2-5.9-13.2-13.2 0-7.3 5.9-13.2 13.2-13.2h33c7.3 0 13.2 5.9 13.2 13.2 0 7.3-5.9 13.2-13.2 13.2H80z"
        fill="#ECB22E"
      />
    </svg>
  );
}

/**
 * Official InkaBoard brand logo
 * Signature purple squircle with 3 Kanban columns and progress indicators
 */
export function InkaBoardLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 100 100"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="InkaBoard logo"
    >
      {/* Background Squircle */}
      <rect width="100" height="100" rx="22" fill="#6522EA" />

      {/* Column 1 (Left): Track + White Card */}
      <rect x="16" y="22" width="18.5" height="56" rx="5.5" fill="white" fillOpacity="0.32" />
      <rect x="16" y="22" width="18.5" height="34" rx="5.5" fill="white" />

      {/* Column 2 (Center): Track + White Card */}
      <rect x="40.75" y="22" width="18.5" height="56" rx="5.5" fill="white" fillOpacity="0.32" />
      <rect x="40.75" y="22" width="18.5" height="47" rx="5.5" fill="white" />

      {/* Column 3 (Right): Track + White Card */}
      <rect x="65.5" y="22" width="18.5" height="56" rx="5.5" fill="white" fillOpacity="0.32" />
      <rect x="65.5" y="22" width="18.5" height="19" rx="5.5" fill="white" />
    </svg>
  );
}

/**
 * Official Atlassian Jira brand logo
 * Signature blue interlocking geometric diamond
 */
export function JiraLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Jira logo"
    >
      <path
        d="M11.56 2.06a.88.88 0 0 0-.62.26L2.32 10.94a.88.88 0 0 0 0 1.24l8.62 8.62c.34.34.9.34 1.24 0l8.62-8.62a.88.88 0 0 0 0-1.24L12.18 2.32a.88.88 0 0 0-.62-.26zm0 4.14l5.42 5.42-5.42 5.42-5.42-5.42 5.42-5.42z"
        fill="#0052CC"
      />
      <path
        d="M11.56 6.2a.88.88 0 0 0-.62.26L7.38 10.02a.88.88 0 0 0 0 1.24l3.56 3.56c.34.34.9.34 1.24 0l3.56-3.56a.88.88 0 0 0 0-1.24l-3.56-3.56a.88.88 0 0 0-.62-.26z"
        fill="#2684FF"
      />
    </svg>
  );
}

/**
 * Official Atlassian Confluence brand logo
 */
export function ConfluenceLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Confluence logo"
    >
      <path
        d="M2.62 17.56c-.28.45-.58.97-.58.97a.62.62 0 0 0 .23.85l3.7 2.27a.63.63 0 0 0 .87-.21s.26-.44.57-.95c1.54-2.55 3.1-2.24 5.95-.88l3.76 1.8a.63.63 0 0 0 .84-.3l1.79-4.02a.62.62 0 0 0-.3-.82l-3.76-1.8c-5.32-2.54-9.85-2.16-13.07 3.09z"
        fill="#2684FF"
      />
      <path
        d="M21.38 6.44c.28-.45.58-.97.58-.97a.62.62 0 0 0-.23-.85L18.03 2.35a.63.63 0 0 0-.87.21s-.26.44-.57.95c-1.54 2.55-3.1 2.24-5.95.88L6.88 2.59a.63.63 0 0 0-.84.3L4.25 6.91a.62.62 0 0 0 .3.82l3.76 1.8c5.32 2.54 9.85 2.16 13.07-3.09z"
        fill="#0052CC"
      />
    </svg>
  );
}

/**
 * Official Notion brand logo (Cube + N mark)
 */
export function NotionLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Notion logo"
    >
      <path
        d="M4.459 4.208c.746.606 1.026.56 2.428.466l13.215-.793c.28 0 .047-.28-.046-.326L17.86 1.968c-.42-.326-.98-.7-2.055-.607L3.01 2.295c-.466.046-.56.28-.374.466l1.823 1.447zm.793 3.08v13.904c0 .747.373 1.027 1.214.98l14.523-.84c.84-.046.934-.56.934-1.166V6.354c0-.606-.233-.933-.747-.886l-15.177.887c-.56.046-.747.326-.747.933zm14.337.745c.093.42 0 .84-.42.888l-.7.14v10.264c-.608.327-1.168.514-1.635.514-.748 0-.935-.234-1.495-.933l-4.577-7.186v6.952L12.21 19s0 .84-1.168.84l-3.222.186c-.093-.186 0-.653.327-.746l.84-.233V9.854L7.822 9.76c-.094-.42.14-1.026.793-1.073l3.456-.233 4.764 7.279v-6.44l-1.215-.14c-.093-.514.28-.886.747-.933l3.222-.187zM2.17 1.127L15.48.147c1.635-.14 2.055-.047 3.082.7l4.25 2.986c.7.513.934.653.934 1.213v16.378c0 1.026-.373 1.634-1.68 1.726l-15.458.934c-.98.046-1.448-.093-1.962-.747l-3.129-4.06c-.56-.747-.793-1.306-.793-1.96V2.853c0-.84.374-1.54 1.446-1.726z"
        fill="currentColor"
      />
    </svg>
  );
}

/**
 * Official Figma 5-petal brand logo
 */
export function FigmaLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 38 57"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Figma logo"
    >
      <path d="M19 28.5a9.5 9.5 0 1 1 19 0 9.5 9.5 0 0 1-19 0z" fill="#1ABCFE" />
      <path d="M0 47.5A9.5 9.5 0 0 1 9.5 38H19v9.5a9.5 9.5 0 1 1-19 0z" fill="#0ACF83" />
      <path d="M19 0v19h9.5a9.5 9.5 0 1 0 0-19H19z" fill="#FF7262" />
      <path d="M0 9.5A9.5 9.5 0 0 0 9.5 19H19V0H9.5A9.5 9.5 0 0 0 0 9.5z" fill="#F24E1E" />
      <path d="M0 28.5A9.5 9.5 0 0 0 9.5 38H19V19H9.5A9.5 9.5 0 0 0 0 28.5z" fill="#A259FF" />
    </svg>
  );
}

/**
 * Official Postman brand logo
 */
export function PostmanLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Postman logo"
    >
      <circle cx="12" cy="12" r="11" fill="#FF6C37" />
      <path
        d="M16.12 7.88a1.25 1.25 0 0 0-1.77 0l-6.4 6.4a.5.5 0 0 0 0 .7l1.06 1.07a.5.5 0 0 0 .71 0l6.4-6.4a1.25 1.25 0 0 0 0-1.77z"
        fill="white"
      />
      <path
        d="M14.7 6.46l2.84 2.84a.75.75 0 0 1 0 1.06l-5.66 5.66a.75.75 0 0 1-1.06 0l-2.84-2.84a.75.75 0 0 1 0-1.06l5.66-5.66a.75.75 0 0 1 1.06 0z"
        fill="white"
        fillOpacity="0.88"
      />
      <circle cx="15.3" cy="8.7" r="1.15" fill="#FF6C37" />
      <path d="M7.2 14.7l2.1 2.1-2.65.55.55-2.65z" fill="white" />
    </svg>
  );
}

/**
 * Official Datadog brand logo
 */
export function DatadogLogo({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="Datadog logo"
    >
      <rect x="1.5" y="1.5" width="21" height="21" rx="5" fill="#632CA6" />
      <path
        d="M16.6 7.2c-1.1-.6-2.4-.7-3.6-.3l-.6-1.1-1.5.8.5 1c-1.4.7-2.4 2-2.7 3.6l-1.9.3.3 1.6 1.8-.3c.4 1.3 1.3 2.4 2.6 3v2.5h1.6v-2.1c1.3.1 2.6-.3 3.6-1.2l1.4 1.2 1.1-1.2-1.3-1.1c.8-1.2 1-2.7.6-4.1l1.4-.7-.7-1.4-1.6.7zm-2.8 6.8c-1.7 0-3-1.3-3-3s1.3-3 3-3 3 1.3 3 3-1.3 3-3 3z"
        fill="white"
      />
      <circle cx="14.5" cy="10.5" r="1.1" fill="#632CA6" />
    </svg>
  );
}

