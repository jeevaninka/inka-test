'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { AlertCircle, ArrowLeft, Loader2 } from 'lucide-react';
import { requestPasswordResetAction } from '@/lib/auth/password-reset-actions';
import styles from '../auth-pages.module.css';

export default function ForgotPasswordForm({ initialEmail }: { initialEmail: string }) {
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await requestPasswordResetAction(email);
      if (!res.success) {
        setError(res.error || 'Could not send the reset link. Please try again.');
        return;
      }
      setSent(true);
    } catch {
      setError('Could not send the reset link. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.root}>
      <div className={styles.aurora} aria-hidden>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
      </div>

      <section className={styles.card}>
        <div className={styles.brand}>
          <span className={styles.logo}><Image src="/logo.svg" alt="InkaTest" width={18} height={18} /></span>
          <span className={styles.brandGradient}>InkaTest</span>
        </div>

        <h1 className={styles.title}>Reset Password</h1>
        <p className={styles.subtitle}>
          Enter the email address associated with your account and we will send you a link to reset your password.
        </p>

        {sent ? (
          <>
            <div className={styles.success} role="status">
              <span>
                If an account exists for <strong>{email.trim()}</strong>, a password reset link has been sent.
                This link will expire in 24 hours.
              </span>
            </div>
            <p className={styles.note} style={{ marginTop: 16 }}>
              Didn&apos;t receive it? Check your spam folder, or try again in a minute.
            </p>
            <div className={styles.links}>
              <button
                type="button"
                className={styles.link}
                style={{ background: 'none', border: 0, cursor: 'pointer', padding: 0 }}
                onClick={() => {
                  setSent(false);
                  setError(null);
                }}
              >
                Use a different email
              </button>
            </div>
          </>
        ) : (
          <form className={styles.form} onSubmit={handleSubmit}>
            <div className={styles.field}>
              <label className={styles.label} htmlFor="reset-email">Email address</label>
              <input
                id="reset-email"
                className={styles.input}
                type="email"
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
            </div>

            {error && (
              <div className={styles.error} role="alert">
                <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
                <span>{error}</span>
              </div>
            )}

            <button className={styles.submit} type="submit" disabled={busy}>
              {busy ? <Loader2 size={18} className={styles.spin} /> : 'Send reset link'}
            </button>
          </form>
        )}

        <div className={styles.links}>
          <Link className={styles.link} href="/login">
            <ArrowLeft size={13} style={{ verticalAlign: '-2px', marginRight: 4 }} />
            Back to sign in
          </Link>
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
