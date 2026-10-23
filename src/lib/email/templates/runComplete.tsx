export function runCompleteTemplate(
  runName: string,
  status: 'PASS' | 'FAIL' | 'PARTIAL',
  passRate: number,
  totalCases: number,
  duration: string,
  runUrl: string,
  defectsCount: number,
  projectName: string,
  options?: {
    pdfUrl?: string;
    passed?: number;
    failed?: number;
    blocked?: number;
    skipped?: number;
    invalid?: number;
  }
): { subject: string; html: string; text: string } {
  const statusColor = status === 'PASS' ? '#10b981' : status === 'FAIL' ? '#ef4444' : '#f59e0b';
  const statusBg = status === 'PASS' ? '#d1fae5' : status === 'FAIL' ? '#fee2e2' : '#fef3c7';
  const statusText = status === 'PASS' ? 'PASSED' : status === 'FAIL' ? 'FAILED' : 'PARTIAL';
  const pdfLink = options?.pdfUrl || `${runUrl}?print=true`;

  const breakdownHtml = options?.passed !== undefined
    ? `
      <div style="margin: 20px 0; padding: 14px 16px; background-color: #f9fafb; border-radius: 8px; border: 1px solid #e5e7eb; font-size: 13px; color: #374151; text-align: center;">
        <span style="color: #059669; font-weight: 600;">✓ ${options.passed} Passed</span>
        <span style="margin: 0 8px; color: #d1d5db;">|</span>
        <span style="color: #dc2626; font-weight: 600;">✗ ${options.failed ?? defectsCount} Failed</span>
        ${options.blocked ? `<span style="margin: 0 8px; color: #d1d5db;">|</span><span style="color: #d97706; font-weight: 600;">⊘ ${options.blocked} Blocked</span>` : ''}
        ${options.skipped ? `<span style="margin: 0 8px; color: #d1d5db;">|</span><span style="color: #6b7280; font-weight: 600;">⏭ ${options.skipped} Skipped</span>` : ''}
        ${options.invalid ? `<span style="margin: 0 8px; color: #d1d5db;">|</span><span style="color: #7c3aed; font-weight: 600;">⚠ ${options.invalid} Invalid</span>` : ''}
      </div>
    `
    : '';

  return {
    subject: `Test Run Complete: ${runName} - ${statusText}`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Test Run Complete</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #0d9488 0%, #2563eb 100%); padding: 36px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 26px; font-weight: 700;">Test Run Complete</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 36px;">
                      <p style="margin: 0 0 20px; color: #1f2937; font-size: 16px; line-height: 1.6;">
                        The test run <strong>${runName}</strong> in project <strong>${projectName}</strong> has completed.
                      </p>
                      
                      <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 24px 0;">
                        <tr>
                          <td style="text-align: center; padding: 20px; background-color: ${statusBg}; border-radius: 8px;">
                            <p style="margin: 0 0 8px; color: ${statusColor}; font-size: 13px; font-weight: 600; text-transform: uppercase;">Status</p>
                            <p style="margin: 0; color: ${statusColor}; font-size: 30px; font-weight: 700;">${statusText}</p>
                          </td>
                        </tr>
                      </table>

                      ${breakdownHtml}

                      <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 24px 0;">
                        <tr>
                          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                            <p style="margin: 0; color: #6b7280; font-size: 13px;">Pass Rate</p>
                            <p style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">${passRate}%</p>
                          </td>
                          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                            <p style="margin: 0; color: #6b7280; font-size: 13px;">Total Cases</p>
                            <p style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">${totalCases}</p>
                          </td>
                        </tr>
                        <tr>
                          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                            <p style="margin: 0; color: #6b7280; font-size: 13px;">Duration</p>
                            <p style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">${duration}</p>
                          </td>
                          <td style="padding: 12px; border-bottom: 1px solid #e5e7eb;">
                            <p style="margin: 0; color: #6b7280; font-size: 13px;">Failed Cases</p>
                            <p style="margin: 0; color: #1f2937; font-size: 20px; font-weight: 600;">${defectsCount}</p>
                          </td>
                        </tr>
                      </table>

                      <table role="presentation" style="margin: 28px auto 10px;">
                        <tr>
                          <td align="center" style="padding: 6px;">
                            <a href="${runUrl}" style="display: inline-block; background: linear-gradient(135deg, #0d9488 0%, #2563eb 100%); color: #ffffff; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 8px; padding: 13px 24px;">View Detailed Report →</a>
                          </td>
                          <td align="center" style="padding: 6px;">
                            <a href="${pdfLink}" style="display: inline-block; background-color: #f3f4f6; color: #1f2937; border: 1px solid #d1d5db; text-decoration: none; font-size: 14px; font-weight: 600; border-radius: 8px; padding: 12px 22px;">Download PDF Report</a>
                          </td>
                        </tr>
                      </table>
                    </td>
                  </tr>
                  <tr>
                    <td style="background-color: #f9fafb; padding: 24px; text-align: center; border-top: 1px solid #e5e7eb;">
                      <p style="margin: 0; color: #9ca3af; font-size: 12px;">
                        InkaTest - AI-First Test Case Management
                      </p>
                    </td>
                  </tr>
                </table>
              </td>
            </tr>
          </table>
        </body>
      </html>
    `,
    text: `Test run ${runName} in ${projectName} completed with status ${statusText}. Pass Rate: ${passRate}%, Total Cases: ${totalCases}, Duration: ${duration}, Failed: ${defectsCount}. View Report: ${runUrl} | Download PDF: ${pdfLink}`,
  };
}