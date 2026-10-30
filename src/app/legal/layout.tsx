import Link from 'next/link';
import Image from 'next/image';
import styles from './legal.module.css';

export const metadata = {
  title: 'Legal — InkaTest',
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
          <span className={styles.logo}><Image src="/logo.svg" alt="InkaTest" width={32} height={32} /></span>
          <span className={styles.brandGradient}>InkaTest</span>
        </Link>
        <nav className={styles.nav}>
          <Link href="/legal/terms">Terms of Service</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/login">Sign in</Link>
        </nav>
      </header>

      <main className={styles.main}>{children}</main>

      <footer className={styles.footer}>
        <div>
          © {new Date().getFullYear()} Karnodakshayi Insurance Pvt Ltd. All rights reserved.
        </div>
        <div className={styles.footerLinks}>
          <Link href="/legal/terms">Terms of Service</Link>
          <Link href="/legal/privacy">Privacy Policy</Link>
          <Link href="/login">Back to sign in</Link>
        </div>
      </footer>
    </div>
  );
}
