export function reviewRequestTemplate(
  requesterName: string,
  testCaseTitle: string,
  reviewUrl: string,
  comment?: string
): { subject: string; html: string; text: string } {
  return {
    subject: `${requesterName} requested your review on "${testCaseTitle}"`,
    html: `
      <!DOCTYPE html>
      <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Review Request</title>
        </head>
        <body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f3f4f6;">
          <table role="presentation" style="width: 100%; border-collapse: collapse;">
            <tr>
              <td align="center" style="padding: 40px 0;">
                <table role="presentation" style="max-width: 600px; width: 100%; border-collapse: collapse; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);">
                  <tr>
                    <td style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); padding: 40px; text-align: center;">
                      <h1 style="margin: 0; color: #ffffff; font-size: 28px; font-weight: 700;">Review Requested</h1>
                    </td>
                  </tr>
                  <tr>
                    <td style="padding: 40px;">
                      <p style="margin: 0 0 20px; color: #1f2937; font-size: 16px; line-height: 1.6;">
                        Hello,
                      </p>
                      <p style="margin: 0 0 20px; color: #1f2937; font-size: 16px; line-height: 1.6;">
                        <strong>${requesterName}</strong> has requested your review on test case <strong>${testCaseTitle}</strong>.
                      </p>
                      
                      ${comment ? `
                      <table role="presentation" style="width: 100%; border-collapse: collapse; margin: 30px 0;">
                        <tr>
                          <td style="padding: 20px; background-color: #f9fafb; border-radius: 8px; border-left: 4px solid #6366f1;">
                            <p style="margin: 0; color: #1f2937; font-size: 15px; line-height: 1.6; font-style: italic;">
                              "${comment}"
                            </p>
                          </td>
                        </tr>
                      </table>
                      ` : ''}

                      <table role="presentation" style="margin: 0 auto 30px;">
                        <tr>
                          <td align="center" style="background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%); border-radius: 8px; padding: 16px 32px;">
                            <a href="${reviewUrl}" style="display: inline-block; color: #ffffff; text-decoration: none; font-size: 16px; font-weight: 600;">Review Test Case →</a>
                          </td>
                        </tr>
                      </table>
                      
                      <p style="margin: 0; color: #6b7280; font-size: 14px; line-height: 1.6;">
                        Please review the test case and provide your feedback.
                      </p>
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
    text: `${requesterName} has requested your review on test case ${testCaseTitle}. ${comment ? `Comment: "${comment}"` : ''} Visit: ${reviewUrl}`
  };
}