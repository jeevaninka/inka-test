import ResetPasswordForm from './ResetPasswordForm';
import { getPasswordResetTokenState } from '@/lib/auth/password-reset';
import Link from 'next/link';
import { Zap } from 'lucide-react';
import styles from '../auth-pages.module.css';

export const metadata = {
  title: 'Reset your password — InkaTest',
};

export const dynamic = 'force-dynamic';

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams?: Promise<{ token?: string }>;
}) {
  const params = searchParams ? await Promise.resolve(searchParams) : {};
  const token = typeof params?.token === 'string' ? params.token : '';
  const { state, email } = await getPasswordResetTokenState(token);

  return (
    <main className={styles.root}>
      <div className={styles.aurora} aria-hidden>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
      </div>

      <section className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo}><Zap size={18} strokeWidth={2.2} /></span>
          <span>Inka<span className={styles.brandAccent}>Test</span></span>
        </div>

        {state === 'VALID' ? (
          <ResetPasswordForm token={token} email={email} />
        ) : (
          <>
            <h1 className={styles.title}>
              {state === 'EXPIRED' ? 'This link has expired' : 'This link is not valid'}
            </h1>
            <p className={styles.subtitle}>
              {state === 'EXPIRED'
                ? 'Password reset links expire after 24 hours. Request a new one to continue.'
                : 'This password reset link is invalid or has already been used. Request a new one to continue.'}
            </p>
            <Link className={styles.submit} href="/forgot-password" style={{ textDecoration: 'none' }}>
              Request a new link
            </Link>
          </>
        )}

        <div className={styles.links}>
          <Link className={styles.link} href="/login">Back to sign in</Link>
        </div>

        <div className={styles.foot}>
          <span>© {new Date().getFullYear()} InkaTest</span>
          <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms</Link>
          <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy</Link>
        </div>
      </section>
    </main>
  );
}
