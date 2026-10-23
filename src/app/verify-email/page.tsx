import Link from 'next/link';
import { getServerSession } from 'next-auth';
import { prisma } from '@/lib/db';
import { authOptions } from '@/lib/auth.config';
import { Button } from '@/components/ui/button';
import { CheckCircle2, AlertCircle, Zap } from 'lucide-react';
import styles from '../(auth)/auth-pages.module.css';

export const dynamic = 'force-dynamic';

export default async function VerifyEmailPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const session = await getServerSession(authOptions);

  let verified = false;

  if (token) {
    const user = await prisma.user.findUnique({
      where: { email_verification_token: token },
      select: { id: true, email_verification_expires: true, email_verified: true },
    });

    if (
      user &&
      (user.email_verified ||
        (user.email_verification_expires && user.email_verification_expires > new Date()))
    ) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          email_verified: true,
          email_verification_token: null,
          email_verification_expires: null,
        },
      });
      verified = true;
    }
  }

  const continueHref = session?.user ? '/pending' : '/login';

  return (
    <main className={styles.root}>
      <div className={styles.aurora} aria-hidden>
        <span className={`${styles.blob} ${styles.blob1}`} />
        <span className={`${styles.blob} ${styles.blob2}`} />
      </div>

      <section className={styles.card} style={{ textAlign: 'center' }}>
        <div className={styles.brand}>
          <span className={styles.logo}><Zap size={18} strokeWidth={2.2} /></span>
          <span>Inka<span className={styles.brandAccent}>Test</span></span>
        </div>

        <div
          className={`mx-auto w-14 h-14 rounded-2xl border flex items-center justify-center ${
            verified
              ? 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              : 'bg-red-500/10 border-red-500/20 text-red-400'
          }`}
        >
          {verified ? <CheckCircle2 className="w-7 h-7" /> : <AlertCircle className="w-7 h-7" />}
        </div>

        <div className="space-y-2">
          <h1 className="text-2xl font-bold text-white">
            {verified ? 'Email verified' : 'Invalid or expired link'}
          </h1>
          <p className="text-sm text-zinc-400 leading-relaxed">
            {verified
              ? 'Your email address is verified. Continue to your account.'
              : 'This verification link is invalid or has expired. Sign in and request a new verification email.'}
          </p>
        </div>

        <Link
          href={continueHref}
          className={styles.submit}
          style={{ textDecoration: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center', marginTop: 24 }}
        >
          {verified ? 'Continue' : 'Back to sign in'}
        </Link>
      </section>
    </main>
  );
}
