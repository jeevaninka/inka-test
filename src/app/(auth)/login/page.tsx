import LoginView from './LoginView';

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ callbackUrl?: string; email?: string }> | { callbackUrl?: string; email?: string };
}) {
  const resolvedParams = searchParams ? await Promise.resolve(searchParams) : {};
  const callbackUrl = resolvedParams?.callbackUrl;
  const email = resolvedParams?.email;

  // Only allow same-origin relative callback paths (avoid open redirect).
  // Default to /pending: the onboarding resolver decides where the user goes.
  const safeCallback =
    callbackUrl && callbackUrl.startsWith('/') && !callbackUrl.startsWith('//')
      ? callbackUrl
      : '/pending';

  return <LoginView callbackUrl={safeCallback} initialEmail={email} />;
}
