'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { signIn } from 'next-auth/react';
import {
  AlertCircle,
  ArrowRight,
  BarChart3,
  Database,
  Eye,
  EyeOff,
  FolderGit2,
  Loader2,
} from 'lucide-react';
import styles from './login.module.css';

type Mode = 'signin' | 'signup';

type Props = {
  callbackUrl?: string;
  initialEmail?: string;
};

const WORDS = ['releases', 'sprints', 'regressions', 'deploys'];

function GoogleIcon() {
  return (
    <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden>
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9.1 3.6l6.8-6.8C35.8 2.4 30.3 0 24 0 14.6 0 6.5 5.4 2.6 13.2l7.9 6.1C12.4 13.6 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.5c0-1.6-.1-3.1-.4-4.5H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.3 5.7c4.3-4 6.9-9.9 6.9-17.1z" />
      <path fill="#FBBC05" d="M10.5 28.7c-.5-1.4-.8-2.9-.8-4.7s.3-3.3.8-4.7l-7.9-6.1C.9 16.4 0 20.1 0 24s.9 7.6 2.6 10.8l7.9-6.1z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.3-5.7c-2 1.4-4.9 2.3-8.6 2.3-6.3 0-11.6-4.1-13.5-9.8l-7.9 6.1C6.5 42.6 14.6 48 24 48z" />
    </svg>
  );
}

export default function LoginView({ callbackUrl = '/pending', initialEmail = '' }: Props) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState(initialEmail);
  const [name, setName] = useState('');
  const [password, setPassword] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | 'google' | 'password'>(null);
  const [wordIdx, setWordIdx] = useState(0);

  // Pointer spotlight — writes CSS coordinates directly to avoid 60fps re-renders
  useEffect(() => {
    const el = rootRef.current;
    if (!el) return;
    const onMove = (e: PointerEvent) => {
      el.style.setProperty('--mx', `${e.clientX}px`);
      el.style.setProperty('--my', `${e.clientY}px`);
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Rotating headline word
  useEffect(() => {
    const t = setInterval(() => setWordIdx((i) => (i + 1) % WORDS.length), 2600);
    return () => clearInterval(t);
  }, []);

  async function handleGoogle() {
    setError(null);
    setBusy('google');
    try {
      await signIn('google', { callbackUrl });
    } catch {
      setError('Google sign-in failed. Please try again.');
      setBusy(null);
    }
  }

  async function handlePassword(e: FormEvent) {
    e.preventDefault();
    setError(null);

    if (mode === 'signup' && !name.trim()) {
      setError('Please enter your full name.');
      return;
    }
    if (mode === 'signup' && !agreed) {
      setError('Please accept the Terms of Service and Privacy Policy to create an account.');
      return;
    }

    setBusy('password');
    try {
      const res = await signIn('credentials', {
        email,
        password,
        name: mode === 'signup' ? name.trim() : undefined,
        action: mode,
        redirect: false,
        callbackUrl,
      });

      if (res?.error) {
        throw new Error(res.error);
      } else if (res?.ok) {
        window.location.href = res.url || callbackUrl;
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid email or password');
      setBusy(null);
    }
  }

  return (
    <main ref={rootRef} className={styles.root}>
      {/* Animated background layers */}
      <div className={styles.aurora} aria-hidden>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
        <span className={`${styles.blob} ${styles.blob3}`} />
      </div>
      {/* Ambient background grid */}
      <div className={styles.grid} aria-hidden />
      {/* Interactive cursor reveal spotlight grid */}
      <div className={styles.gridReveal} aria-hidden />
      <div className={styles.spotlight} aria-hidden />

      {/* ──────────────────────── Hero (Left) ──────────────────────── */}
      <section className={styles.hero} aria-hidden={false}>
        {/* Brand Header Bar: Logo + Name + "AI-first test management" shifted to the right */}
        <div className={`${styles.brand} ${styles.reveal}`} style={{ ['--d' as string]: '0.05s' }}>
          <div className={styles.brandMain}>
            <span className={styles.logo}><Image src="/logo.svg" alt="InkaTest" width={38} height={38} /></span>
            <span className="text-lg font-bold gradient-text">InkaTest</span>
          </div>

          <span className={styles.eyebrow} aria-label="Product tag">
            <i className={styles.eyebrowDot} /> AI-first test management
          </span>
        </div>

        <div className={styles.heroBody}>
          <h1 className={`${styles.headline} ${styles.reveal}`} style={{ ['--d' as string]: '0.2s' }}>
            Quality that keeps pace with your
            <span className={styles.rotator}>
              <span key={wordIdx} className={styles.rotWord}>{WORDS[wordIdx]}</span>
            </span>
          </h1>

          <p className={`${styles.sub} ${styles.reveal}`} style={{ ['--d' as string]: '0.3s' }}>
            Plan, execute and review every test cycle in one place — with AI that drafts cases,
            spots duplicate defects and keeps your releases honest.
          </p>

          {/* Floating product vignettes */}
          <div className={`${styles.stage} ${styles.reveal}`} style={{ ['--d' as string]: '0.45s' }} aria-hidden>
            {/* Vignette 1: Run #482 */}
            <div className={`${styles.float} ${styles.fRun}`}>
              <div className={styles.cardLabel}>Run #482 · Regression</div>
              <div className={styles.runTop}>
                <svg className={styles.ring} viewBox="0 0 64 64">
                  <defs>
                    <linearGradient id="ringGrad" x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor="#5fd0b8" />
                      <stop offset="1" stopColor="#4aa8ff" />
                    </linearGradient>
                  </defs>
                  <circle className={styles.ringTrack} cx="32" cy="32" r="28" fill="none" strokeWidth="6" />
                  <circle className={styles.ringFill} cx="32" cy="32" r="28" fill="none" strokeWidth="6" />
                </svg>
                <div className={styles.runMeta}>
                  <strong>87% passing</strong>
                  <span>staging · build 2.14</span>
                </div>
              </div>
              <div className={styles.chips}>
                <span className={`${styles.chip} ${styles.pass}`}>142 pass</span>
                <span className={`${styles.chip} ${styles.fail}`}>6 fail</span>
                <span className={`${styles.chip} ${styles.pend}`}>15 pending</span>
              </div>
            </div>

            {/* Vignette 2: Test Cases */}
            <div className={`${styles.float} ${styles.fCases}`}>
              {[
                ['INK-212', 'Policy issuance — happy path', 'pass', 'Pass'],
                ['INK-219', 'Premium calc — GST edge case', 'fail', 'Fail'],
                ['INK-231', 'KYC document upload', 'running', 'Running'],
              ].map(([k, t, s, label], i) => (
                <div key={k} className={styles.row} style={{ ['--d' as string]: `${0.85 + i * 0.25}s` }}>
                  <span className={styles.rowKey}>{k}</span>
                  <span className={styles.rowTitle}>{t}</span>
                  <span
                    className={`${styles.status} ${s === 'pass' ? styles.pass : s === 'fail' ? styles.fail : styles.running}`}
                    style={s !== 'running' ? { padding: '2px 8px', borderRadius: 999 } : undefined}
                  >
                    {s === 'running' && <i />}{label}
                  </span>
                </div>
              ))}
            </div>

            {/* Vignette 3: AI Copilot */}
            <div className={`${styles.float} ${styles.fAi}`}>
              <span className={styles.spark}><Image src="/logo.svg" alt="" width={16} height={16} /></span>
              <span>12 cases drafted by AI · <b style={{ color: 'var(--brand-3)' }}>Draft</b></span>
            </div>
          </div>
        </div>

        {/* ── Trust items: Repository & Coverage ── */}
        <div className={`${styles.trust} ${styles.reveal}`} style={{ ['--d' as string]: '0.65s' }}>
          <span><FolderGit2 size={15} /> Centralized test repository</span>
          <span><Database size={15} /> Reusable dataset suites</span>
          <span><BarChart3 size={15} /> Real-time coverage analytics</span>
        </div>
      </section>

      {/* ──────────────────────── Auth panel (Right) ──────────────────────── */}
      <section className={styles.panel}>
        <div className={`${styles.card} ${styles.reveal}`} style={{ ['--d' as string]: '0.2s' }}>
          <header className={styles.cardHead}>
            <div className={styles.cardLogo}><Image src="/logo.svg" alt="InkaTest" width={54} height={54} /></div>
            <h2 className={styles.title}>
              Welcome to <span className={styles.gradientText}>InkaTest</span>
            </h2>
            <p className={styles.subtitle}>Sign in to continue to your workspace.</p>
          </header>

          <button className={styles.googleBtn} onClick={handleGoogle} disabled={busy !== null} type="button">
            {busy === 'google' ? <Loader2 size={18} className={styles.spin} /> : <GoogleIcon />}
            Continue with Google
          </button>

          <div className={styles.divider}><span className={styles.dividerLabel}>or</span></div>

          <div className={styles.tabs} role="tablist">
            <span className={`${styles.indicator} ${mode === 'signup' ? styles.indicatorRight : ''}`} />
            {(['signin', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                className={`${styles.tab} ${mode === m ? styles.tabActive : ''}`}
                onClick={() => { setMode(m); setError(null); }}
              >
                {m === 'signin' ? 'Sign In' : 'Sign Up'}
              </button>
            ))}
          </div>

          <form className={styles.form} onSubmit={handlePassword}>
            {mode === 'signup' && (
              <div className={styles.field}>
                <input
                  id="name"
                  className={styles.input}
                  type="text"
                  placeholder=" "
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                />
                <label className={styles.label} htmlFor="name">Full name</label>
              </div>
            )}
            <div className={styles.field}>
              <input
                id="email"
                className={styles.input}
                type="email"
                placeholder=" "
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
              />
              <label className={styles.label} htmlFor="email">Email address</label>
            </div>
            <div className={styles.field}>
              <input
                id="password"
                className={styles.input}
                type={showPw ? 'text' : 'password'}
                placeholder=" "
                autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
              />
              <label className={styles.label} htmlFor="password">Password</label>
              <button
                type="button"
                className={styles.eye}
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
              >
                {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
              </button>
            </div>

            {mode === 'signin' ? (
              <div className={styles.forgotRow}>
                <a className={styles.inlineLink} href="/forgot-password">
                  Forgot password?
                </a>
              </div>
            ) : (
              <label className={styles.consent}>
                <input
                  type="checkbox"
                  className={styles.consentBox}
                  checked={agreed}
                  onChange={(e) => setAgreed(e.target.checked)}
                />
                <span>
                  I agree to the{' '}
                  <a className={styles.inlineLink} href="/legal/terms" target="_blank" rel="noopener noreferrer">
                    Terms of Service
                  </a>{' '}
                  and{' '}
                  <a className={styles.inlineLink} href="/legal/privacy" target="_blank" rel="noopener noreferrer">
                    Privacy Policy
                  </a>
                  .
                </span>
              </label>
            )}

            {error && (
              <div key={error} className={styles.error} role="alert">
                <AlertCircle size={16} /> {error}
              </div>
            )}

            <button className={styles.submit} type="submit" disabled={busy !== null}>
              {busy === 'password' ? (
                <Loader2 size={18} className={styles.spin} />
              ) : (
                <>
                  {mode === 'signin' ? 'Sign In' : 'Create account'}
                  <ArrowRight size={18} className={styles.arrow} />
                </>
              )}
            </button>
          </form>

          <footer className={styles.legalFoot}>
            <div className={styles.legalLinks}>
              <a href="/legal/terms" target="_blank" rel="noopener noreferrer">Terms of Service</a>
              <span aria-hidden>·</span>
              <a href="/legal/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>
            </div>
            <div className={styles.foot}>© {new Date().getFullYear()} INKATEST</div>
          </footer>
        </div>
      </section>
    </main>
  );
}
