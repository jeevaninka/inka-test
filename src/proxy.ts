import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

function isPublicEndpoint(pathname: string, method?: string): boolean {
  if (pathname === '/api/health') return true;
  if (pathname.startsWith('/api/auth')) return true;
  if (pathname === '/api/v1/logs') return true;
  if (pathname.endsWith('/webhooks/incoming') || pathname.endsWith('/webhooks/pm-tool')) return true;
  if (pathname.startsWith('/api/v1/runs/') && pathname.endsWith('/results') && method === 'PATCH') return true;
  return false;
}

export default withAuth(
  function proxy(req) {
    const token = req.nextauth.token;
    const pathname = req.nextUrl.pathname;

    // Public integration endpoints bypass edge session check
    if (isPublicEndpoint(pathname, req.method)) {
      return NextResponse.next();
    }

    const isApproved = !!token?.isApproved;
    const hasWorkspace = !!token?.workspaceId;
    const onSetup = pathname === '/setup';
    const onPending = pathname === '/pending';
    const onWorkspaceList = pathname === '/workspace';

    // Approved users without workspace on /setup → allow
    if (isApproved && !hasWorkspace && onSetup) {
      return NextResponse.next();
    }

    // Approved users without workspace on /workspace → allow (empty state page)
    if (isApproved && !hasWorkspace && onWorkspaceList) {
      return NextResponse.next();
    }

    // Approved users without workspace → /workspace (empty state with create/request)
    if (isApproved && !hasWorkspace && !onSetup && !onWorkspaceList) {
      return NextResponse.redirect(new URL('/workspace', req.url));
    }

    // Approved users with workspace on /setup → /workspace
    if (isApproved && hasWorkspace && onSetup) {
      return NextResponse.redirect(new URL('/workspace', req.url));
    }

    // Unapproved users → /pending
    if (!isApproved && !onPending) {
      return NextResponse.redirect(new URL('/pending', req.url));
    }

    // Approved users with workspace on /pending → /workspace
    if (isApproved && hasWorkspace && onPending) {
      return NextResponse.redirect(new URL('/workspace', req.url));
    }

    // Approved users without workspace on /pending → /workspace
    if (isApproved && !hasWorkspace && onPending) {
      return NextResponse.redirect(new URL('/workspace', req.url));
    }

    // Redirect /projects (post-login / root) to /workspace (all workspaces list)
    if (pathname === '/projects') {
      return NextResponse.redirect(new URL('/workspace', req.url));
    }

    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ req, token }) => {
        if (isPublicEndpoint(req.nextUrl.pathname, req.method)) {
          return true;
        }
        return !!token;
      },
    },
    pages: {
      signIn: '/login',
    },
  }
);

export const config = {
  matcher: [
    "/p/:path*",
    "/projects",
    "/workspace/:path*",
    "/org/:path*",
    "/platform-admin/:path*",
    "/pending",
    "/suspended",
    "/setup",
    "/runs/:path*",
  ],
};
