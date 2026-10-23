import Link from 'next/link';
import { Zap } from 'lucide-react';
import styles from './legal.module.css';

export const metadata = {
  title: 'Legal — InkaTest',
  description: 'InkaTest terms of service and privacy policy.',
};

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className={styles.root}>
      <div className={styles.aurora} aria-hidden>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
      </div>

      <header className={styles.header}>
        <Link className={styles.brand} href="/login">
          <span className={styles.logo}><Zap size={17} strokeWidth={2.2} /></span>
          <span>Inka<span className={styles.brandAccent}>Test</span></span>
        </Link>
        <nav className={styles.nav}>
          <Link href="/legal/terms">Terms of Service</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <div>© {new Date().getFullYear()} InkaTest. All rights reserved.</div>
        <div className={styles.footerLinks}>
          <Link href="/legal/terms">Terms of Service</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/login">Back to sign in</Link>
        </div>
      </footer>
    </div>
  );
}
