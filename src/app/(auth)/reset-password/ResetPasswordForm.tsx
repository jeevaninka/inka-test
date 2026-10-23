'use client';

import { FormEvent, useState } from 'react';
import Link from 'next/link';
import { AlertCircle, CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react';
import { resetPasswordAction } from '@/lib/auth/password-reset-actions';
import styles from '../auth-pages.module.css';

export default function ResetPasswordForm({
  token,
  email,
}: {
  token: string;
  email?: string;
}) {
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res = await resetPasswordAction({ token, password, confirmPassword });
      if (!res.success) {
        setError(res.error || 'Could not reset your password. Please try again.');
        return;
      }
      setDone(true);
      setPassword('');
      setConfirmPassword('');
    } catch {
      setError('Could not reset your password. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <>
        <h1 className={styles.title}>Password updated</h1>
        <p className={styles.subtitle}>
          Your password has been successfully updated.
        </p>
        <div className={styles.success} role="status">
          <CheckCircle2 size={16} style={{ flexShrink: 0, marginTop: 1 }} />
          <span>You can now sign in using your new password.</span>
        </div>
        <Link
          className={styles.submit}
          href={email ? `/login?email=${encodeURIComponent(email)}` : '/login'}
          style={{ textDecoration: 'none', marginTop: 20 }}
        >
          Continue to sign in
        </Link>
      </>
    );
  }

  return (
    <>
      <h1 className={styles.title}>Reset your password</h1>
      <p className={styles.subtitle}>
        {email ? (
          <>Create a new password for <strong>{email}</strong>.</>
        ) : (
          'Please enter a new, secure password.'
        )}
      </p>

      <form className={styles.form} onSubmit={handleSubmit}>
        <div className={styles.field}>
          <label className={styles.label} htmlFor="new-password">New password</label>
          <div style={{ position: 'relative' }}>
            <input
              id="new-password"
              className={styles.input}
              type={showPw ? 'text' : 'password'}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              style={{ paddingRight: 44 }}
            />
            <button
              type="button"
              aria-label={showPw ? 'Hide password' : 'Show password'}
              onClick={() => setShowPw((v) => !v)}
              style={{
                position: 'absolute',
                right: 6,
                top: 6,
                width: 36,
                height: 36,
                border: 0,
                borderRadius: 9,
                background: 'none',
                color: '#8a9ba6',
                cursor: 'pointer',
                display: 'grid',
                placeItems: 'center',
              }}
            >
              {showPw ? <EyeOff size={17} /> : <Eye size={17} />}
            </button>
          </div>
        </div>

        <div className={styles.field}>
          <label className={styles.label} htmlFor="confirm-password">Confirm new password</label>
          <input
            id="confirm-password"
            className={styles.input}
            type={showPw ? 'text' : 'password'}
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
            required
          />
        </div>

        <p className={styles.note}>
          At least 10 characters, with one uppercase letter and one number.
        </p>

        {error && (
          <div className={styles.error} role="alert">
            <AlertCircle size={16} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{error}</span>
          </div>
        )}

        <button className={styles.submit} type="submit" disabled={busy}>
          {busy ? <Loader2 size={18} className={styles.spin} /> : 'Update password'}
        </button>
      </form>
    </>
  );
}
