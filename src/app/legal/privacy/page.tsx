import styles from '../legal.module.css';

export const metadata = {
  title: 'Privacy Policy — InkaTest',
  description: 'How InkaTest collects, uses, and protects your data.',
};

const LAST_UPDATED = 'October 23, 2026';

export default function PrivacyPage() {
  return (
    <>
      <p className={styles.eyebrow}>Legal</p>
      <h1 className={styles.title}>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

      <div className={styles.intro}>
        This Privacy Policy explains how{' '}
        <span className={styles.placeholder}>[Company legal name]</span>{' '}
        (&ldquo;InkaTest&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and shares
        personal information when you use our website and test management platform.
      </div>

      <section className={styles.section}>
        <h2>1. Information we collect</h2>
        <h3>Information you provide</h3>
        <ul>
          <li>Account details such as your name, email address, and password (stored hashed).</li>
          <li>Organization, workspace, and project membership information.</li>
          <li>Content you submit, such as test cases, results, comments, and attachments.</li>
          <li>Support requests and other communications with us.</li>
        </ul>
        <h3>Information collected automatically</h3>
        <ul>
          <li>Log data such as IP address, browser type, and pages accessed.</li>
          <li>Usage data about features you interact with, used to improve the product.</li>
          <li>Cookies and similar technologies needed to keep you signed in and secure.</li>
        </ul>
        <h3>Information from third parties</h3>
        <p>
          If you sign in with Google or another identity provider, we receive basic profile
          information such as your name, email address, and profile picture.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. How we use information</h2>
        <ul>
          <li>To create and secure your account, including email verification and password resets.</li>
          <li>To provide, maintain, and improve the service.</li>
          <li>To manage organization access, invitations, and approvals.</li>
          <li>To communicate service updates, security alerts, and respond to support requests.</li>
          <li>To detect abuse, fraud, and security incidents, and to comply with legal obligations.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>3. Legal bases</h2>
        <p>
          Where required, we rely on the following legal bases to process personal information:
          performance of a contract (providing the service), legitimate interests (securing and
          improving the service), consent (optional communications), and legal obligation.
        </p>
      </section>

      <section className={styles.section}>
        <h2>4. Sharing and disclosure</h2>
        <p>We do not sell personal information. We may share it with:</p>
        <ul>
          <li>Service providers who host infrastructure, send email, or provide analytics on our behalf.</li>
          <li>Your organization administrators, as part of workspace and access management.</li>
          <li>Authorities when required by law or to protect rights, safety, and security.</li>
          <li>A successor entity in connection with a merger, acquisition, or asset sale.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>5. Data retention</h2>
        <p>
          We retain personal information for as long as your account is active and for a reasonable
          period afterward to meet legal, security, and operational requirements. Verification and
          password reset tokens are single-use and expire automatically.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Security</h2>
        <p>
          We use industry-standard safeguards, including encryption in transit, hashed passwords, and
          access controls. No method of transmission or storage is perfectly secure, so we cannot
          guarantee absolute security.
        </p>
      </section>

      <section className={styles.section}>
        <h2>7. Cookies</h2>
        <p>
          We use strictly necessary cookies to authenticate sessions and protect against abuse. We do
          not use advertising cookies. You can control cookies through your browser, but disabling
          necessary cookies may prevent sign-in.
        </p>
      </section>

      <section className={styles.section}>
        <h2>8. Your rights</h2>
        <p>
          Depending on your location, you may have the right to access, correct, delete, or export
          your personal information, to object to or restrict certain processing, and to withdraw
          consent. To exercise these rights, contact us at{' '}
          <span className={styles.placeholder}>[privacy@your-domain]</span>. You may also lodge a
          complaint with your local data protection authority.
        </p>
      </section>

      <section className={styles.section}>
        <h2>9. International transfers</h2>
        <p>
          We may process information in countries other than yours. Where required, we rely on
          appropriate safeguards such as standard contractual clauses for international transfers.
        </p>
      </section>

      <section className={styles.section}>
        <h2>10. Children</h2>
        <p>
          The service is not intended for children under 16, and we do not knowingly collect personal
          information from them. If you believe a child has provided us with personal information,
          contact us and we will delete it.
        </p>
      </section>

      <section className={styles.section}>
        <h2>11. Changes to this policy</h2>
        <p>
          We may update this Privacy Policy from time to time. Material changes will be announced in
          the product or by email before they take effect.
        </p>
      </section>

      <section className={styles.section}>
        <h2>12. Contact</h2>
        <p>
          For privacy questions or requests, contact{' '}
          <span className={styles.placeholder}>[privacy@your-domain]</span> or write to{' '}
          <span className={styles.placeholder}>[registered address]</span>.
        </p>
      </section>
    </>
  );
}
