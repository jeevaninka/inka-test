import ForgotPasswordForm from './ForgotPasswordForm';

export const metadata = {
  title: 'Reset your password — InkaTest',
};

export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ email?: string }>;
}) {
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const email = typeof params?.email === 'string' ? params.email : '';

  return <ForgotPasswordForm initialEmail={email} />;
}
