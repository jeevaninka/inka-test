import styles from '../legal.module.css';

export const metadata = {
  title: 'Privacy Policy — InkaTest',
  description: 'How InkaTest collects, uses, and protects your data.',
};

const LAST_UPDATED = 'October 29, 2026';

export default function PrivacyPage() {
  return (
    <>
      <p className={styles.eyebrow}>Legal</p>
      <h1 className={styles.title}>Privacy Policy</h1>
      <p className={styles.updated}>Last updated: {LAST_UPDATED}</p>

      <div className={styles.intro}>
        This Privacy Policy explains how Karnodakshayi Insurance Pvt Ltd (&ldquo;the
        Organisation&rdquo;, &ldquo;we&rdquo;, &ldquo;us&rdquo;) collects, uses, and shares personal
        information when you use InkaTest, an internal test management platform for its employees
        and authorised personnel.
      </div>

      <section className={styles.section}>
        <h2>1. Information we collect</h2>

        <h3>Information you provide</h3>
        <ul>
          <li>Account details such as your name, work email address, and password (stored hashed).</li>
          <li>Organisation, workspace, and project membership information.</li>
          <li>Content you submit, such as test cases, results, comments, and attachments.</li>
          <li>Support requests and other communications with the IT/Support team.</li>
        </ul>

        <h3>Information collected automatically</h3>
        <ul>
          <li>Log data such as IP address, browser type, and pages accessed.</li>
          <li>Usage data about the features you use, to help improve the platform.</li>
          <li>Cookies needed to keep you signed in and secure.</li>
        </ul>

        <h3>Information from identity providers</h3>
        <p>
          If you sign in with Google or another single sign-on provider, we receive basic profile
          information such as your name, work email address, and profile picture.
        </p>
      </section>

      <section className={styles.section}>
        <h2>2. How we use information</h2>
        <ul>
          <li>To create and secure your account, including email verification and password resets.</li>
          <li>To provide, maintain, and improve InkaTest.</li>
          <li>To manage workspace access, invitations, and approvals.</li>
          <li>
            To send service updates and security alerts, and to respond to support requests.
          </li>
          <li>
            To detect misuse and security incidents, to audit usage, and to comply with legal
            obligations and Organisation policies.
          </li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>3. Sharing and disclosure</h2>
        <p>We do not sell personal information. Data may be shared with:</p>
        <ul>
          <li>
            Organisation administrators and authorised IT/security personnel, for access
            management, support, and audits.
          </li>
          <li>
            Service providers that host infrastructure or send email on the Organisation&rsquo;s
            behalf, under appropriate confidentiality and security terms.
          </li>
          <li>Authorities, where required by law.</li>
        </ul>
      </section>

      <section className={styles.section}>
        <h2>4. Data retention</h2>
        <p>
          Personal information is retained while your account is active and for a reasonable period
          afterwards to meet legal, security, audit, and operational needs, in line with the
          Organisation&rsquo;s retention policy. Verification and password reset tokens are
          single-use and expire automatically.
        </p>
      </section>

      <section className={styles.section}>
        <h2>5. Security</h2>
        <p>
          We use reasonable safeguards, including encryption in transit, hashed passwords, and
          access controls. No system is completely secure, so absolute security cannot be
          guaranteed.
        </p>
      </section>

      <section className={styles.section}>
        <h2>6. Cookies</h2>
        <p>
          InkaTest uses only strictly necessary cookies to authenticate sessions and protect against
          abuse. No advertising cookies are used. Disabling necessary cookies may prevent you from
          signing in.
        </p>
      </section>

      <section className={styles.section}>
        <h2>7. Your rights</h2>
        <p>
          Depending on applicable law, you may have the right to access, correct, or request
          deletion of your personal information. To make a request, contact{' '}
          <a href="mailto:tech@inkasure.com">tech@inkasure.com</a>. Some data may need to be retained
          for legal, security, or audit reasons.
        </p>
      </section>

      <section className={styles.section}>
        <h2>8. Data location</h2>
        <p>
          InkaTest data is stored and processed on infrastructure managed by or on behalf of the
          Organisation. Where service providers process data in other countries, appropriate
          safeguards are applied as required by law.
        </p>
      </section>

      <section className={styles.section}>
        <h2>9. Relationship to other policies</h2>
        <p>
          This notice works alongside the Organisation&rsquo;s employee privacy notice, IT
          acceptable-use policy, and information security policy. If there is a conflict, those
          policies prevail.
        </p>
      </section>

      <section className={styles.section}>
        <h2>10. Changes to this policy</h2>
        <p>
          We may update this policy from time to time. Updates take effect when posted in the
          product, and material changes will be communicated to users.
        </p>
      </section>

      <section className={styles.section}>
        <h2>11. Contact</h2>
        <p>
          For privacy questions or requests, contact{' '}
          <a href="mailto:tech@inkasure.com">tech@inkasure.com</a>.
        </p>
      </section>
    </>
  );
}
