import styles from '../legal.module.css';

export const metadata = {
  title: 'Terms of Service — InkaTest',
  description: 'The terms that govern your use of InkaTest.',
};

const LAST_UPDATED = 'October 29, 2026';

export default function TermsPage() {
  return (
    <>
      <p className={styles.eyebrow}>Legal</p>
      <h1 className={styles.title}>Terms of Service</h1>
      <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

      <div className={styles.intro}>
        These Terms of Service (&ldquo;Terms&rdquo;) govern your access to and use of InkaTest, an
        internal test management platform operated by Karnodakshayi Insurance Pvt Ltd
        (&ldquo;the Organisation&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) for use by its
        employees and authorised personnel. By accessing or using InkaTest, you agree to these
        Terms.
      </div>

      <section className={styles.section}>
        <h2>1. Eligibility and accounts</h2>
        <p>
          InkaTest is available only to authorised users of the Organisation. You must use your
          official work credentials, keep them secure, and not share them with anyone. You are
          responsible for activity carried out under your account. Access may be suspended or
          removed if your account is inactive, compromised, or no longer authorised.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. Acceptable use</h2>
        <p>You agree not to:</p>
        <ul>
          <li>Use InkaTest in violation of applicable law or Organisation policies.</li>
          <li>Attempt to gain unauthorised access to accounts, data, or infrastructure.</li>
          <li>
            Upload malicious code, interfere with the service, or probe its security without
            written approval.
          </li>
          <li>
            Share InkaTest data with unauthorised persons or use it for non-work purposes.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>3. Organisation content</h2>
        <p>
          Test cases, results, attachments, and other content submitted to InkaTest
          (&ldquo;Content&rdquo;) belong to the Organisation. You must have the right to upload any
          Content you submit and should not store sensitive personal, customer, or confidential data
          unless approved by the Organisation&rsquo;s policies.
        </p>
      </section>

      <section className={styles.section}>
        <h2>4. Monitoring and data use</h2>
        <p>
          Use of InkaTest may be logged and monitored for security, support, and auditing purposes,
          in line with the Organisation&rsquo;s IT and privacy policies. Account and activity data
          are handled as described in the Organisation&rsquo;s applicable privacy notices.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Availability and support</h2>
        <p>
          We aim to keep InkaTest available and secure but do not guarantee uninterrupted access.
          The service may be changed, suspended, or discontinued for maintenance, upgrades, or
          business reasons.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Disclaimer and liability</h2>
        <p>
          InkaTest is provided &ldquo;as is&rdquo; and &ldquo;as available&rdquo;. To the extent
          permitted by law, the Organisation is not liable for indirect or consequential loss
          arising from use of, or inability to use, the service.
        </p>
      </section>

      <section className={styles.section}>
        <h2>7. Suspension and termination</h2>
        <p>
          Access may be suspended or ended at any time, including if you breach these Terms, leave
          the Organisation, change roles, or if required for security or legal reasons.
        </p>
      </section>

      <section className={styles.section}>
        <h2>8. Changes to these Terms</h2>
        <p>
          We may update these Terms from time to time. Updates take effect when posted in the
          product, and continued use means you accept the updated Terms.
        </p>
      </section>

      <section className={styles.section}>
        <h2>9. Governing policies and law</h2>
        <p>
          These Terms operate alongside the Organisation&rsquo;s employment terms, IT
          acceptable-use policy, and code of conduct. If there is a conflict, those policies
          prevail. These Terms are governed by the laws applicable to the Organisation&rsquo;s
          registered jurisdiction.
        </p>
      </section>

      <section className={styles.section}>
        <h2>10. Contact</h2>
        <p>
          For questions about these Terms, contact{' '}
          <a href="mailto:tech@inkasure.com">tech@inkasure.com</a>.
        </p>
      </section>
    </>
  );
}
