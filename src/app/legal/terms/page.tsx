import styles from '../legal.module.css';

export const metadata = {
  title: 'Terms of Service — InkaTest',
  description: 'The terms that govern your use of InkaTest.',
};

const LAST_UPDATED = 'October 23, 2026';

export default function TermsPage() {
  return (
    <>
      <p className={styles.eyebrow}>Legal</p>
      <h1 className={styles.title}>Terms of Service</h1>
      <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

      <div className={styles.intro}>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of InkaTest, a
        test management platform provided by{' '}
        <span className={styles.placeholder}>[Company legal name]</span>{' '}
        (&ldquo;InkaTest&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;). By creating an account or using
        the service you agree to these Terms. If you are accepting them on behalf of an organization,
        you represent that you have authority to bind that organization.
      </div>

      <section className={styles.section}>
        <h2>1. Accounts</h2>
        <p>
          You must provide accurate account information and keep your credentials secure. You are
          responsible for all activity that occurs under your account. Accounts may be created with
          an email address and password or through a supported single sign-on provider.
        </p>
        <p>
          You must verify your email address before accessing invitations or organization
          workspaces. We may suspend accounts that remain unverified or that we reasonably believe
          are being used fraudulently.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use the service in violation of applicable law or the rights of others.</li>
          <li>Attempt to gain unauthorized access to accounts, workspaces, or infrastructure.</li>
          <li>Upload malicious code, interfere with the service, or probe its security without permission.</li>
          <li>Resell, sublicense, or provide the service to third parties except as permitted in writing.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>3. Customer content</h2>
        <p>
          You retain ownership of the test cases, results, attachments, and other content you submit
          (&ldquo;Customer Content&rdquo;). You grant us a limited license to host, process, and
          display Customer Content solely to provide and improve the service. You are responsible
          for having the necessary rights to the content you upload.
        </p>
      </section>

      <section className={styles.section}>
        <h2>4. Intellectual property</h2>
        <p>
          The service, including its software, design, and documentation, is owned by InkaTest and
          its licensors and is protected by intellectual property laws. These Terms do not grant you
          any rights to our trademarks or branding.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Subscriptions and payment</h2>
        <p>
          Paid plans are billed according to the plan you select. Fees are non-refundable except
          where required by law or expressly stated in an order form. We may change pricing with
          reasonable advance notice; continued use after the change constitutes acceptance.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Availability and support</h2>
        <p>
          We work to keep the service available and secure, but we do not guarantee uninterrupted
          access. Scheduled maintenance, third-party outages, and events outside our reasonable
          control may affect availability.
        </p>
      </section>

      <section className={styles.section}>
        <h2>7. Disclaimers</h2>
        <p>
          The service is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the maximum
          extent permitted by law, we disclaim all warranties, express or implied, including
          merchantability, fitness for a particular purpose, and non-infringement.
        </p>
      </section>

      <section className={styles.section}>
        <h2>8. Limitation of liability</h2>
        <p>
          To the maximum extent permitted by law, neither party will be liable for indirect,
          incidental, special, consequential, or punitive damages, or for lost profits or revenues.
          Our aggregate liability arising out of these Terms will not exceed the amounts paid by you
          for the service in the twelve months preceding the claim.
        </p>
      </section>

      <section className={styles.section}>
        <h2>9. Termination</h2>
        <p>
          You may stop using the service at any time. We may suspend or terminate access if you
          materially breach these Terms, if required by law, or if your account poses a security
          risk. On termination, your right to use the service ends; sections that by their nature
          should survive will survive.
        </p>
      </section>

      <section className={styles.section}>
        <h2>10. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. Material changes will be announced in the
          product or by email before they take effect. Continued use of the service after the
          effective date constitutes acceptance of the updated Terms.
        </p>
      </section>

      <section className={styles.section}>
        <h2>11. Governing law</h2>
        <p>
          These Terms are governed by the laws of{' '}
          <span className={styles.placeholder}>[governing jurisdiction]</span>, without regard to
          conflict-of-law rules. Courts located in{' '}
          <span className={styles.placeholder}>[venue]</span> will have exclusive jurisdiction,
          subject to any mandatory local law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>12. Contact</h2>
        <p>
          Questions about these Terms? Contact us at{' '}
          <span className={styles.placeholder}>[legal@your-domain]</span> or at{' '}
          <span className={styles.placeholder}>[registered address]</span>.
        </p>
      </section>
    </>
  );
}
