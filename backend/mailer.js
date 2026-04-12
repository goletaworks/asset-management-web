// backend/mailer.js
// Lightweight mail helper with graceful fallback to console logging.
const nodemailer = require('nodemailer');

function buildTransport() {
  const { SMTP_URL, SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, SMTP_SECURE } = process.env;

  try {
    if (SMTP_URL) {
      return nodemailer.createTransport(SMTP_URL);
    }

    if (!SMTP_HOST) {
      return null; // No config – will fall back to console logging
    }

    return nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT) || 587,
      secure: String(SMTP_SECURE || '').toLowerCase() === 'true',
      auth: SMTP_USER && SMTP_PASS ? { user: SMTP_USER, pass: SMTP_PASS } : undefined
    });
  } catch (err) {
    console.warn('[mailer] Failed to build transport:', err.message);
    return null;
  }
}

/**
 * Send the access request email. If SMTP is not configured, it logs the email
 * contents instead so the flow can still be tested for free.
 */
async function sendAccessRequestEmail({ to, requesterName, requesterEmail, reason, permissionLevel, code, approverName }) {

  const transport = buildTransport();
  const from = process.env.SMTP_FROM || 'ASMGT Access <no-reply@asmgt.local>';

  const subject = `Access Request: ${requesterName || 'New User'}`;
  const body = [
    `You have a new access request for Asset Management.`,
    '',
    `Requester: ${requesterName || 'N/A'}`,
    `Email: ${requesterEmail || 'N/A'}`,
    `Reason: ${reason || 'N/A'}`,
    `Requested Permission Level: ${permissionLevel || 'N/A'}`,
    '',
    `Access Code: ${code}`,
    '',
    `Please share this code with the requester to allow them to complete signup.`
  ].join('\n');

  // If no transport configured, log to console for a free fallback.
  if (!transport) {
    console.warn('[mailer] No SMTP configured; logging email instead.');
    console.log('--- ACCESS REQUEST EMAIL (not sent) ---');
    console.log('To:', to);
    console.log('Subject:', subject);
    console.log(body);
    console.log('---------------------------------------');
    return { success: true, simulated: true, message: 'Email not configured; logged to console.' };
  }

  try {
    await transport.sendMail({
      from,
      to,
      subject,
      text: body
    });
    return { success: true };
  } catch (err) {
    console.error('[mailer] Failed to send email:', err);
    return { success: false, message: err.message };
  }
}

module.exports = {
  sendAccessRequestEmail
};
