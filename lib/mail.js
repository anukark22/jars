/* Password-reset email through Resend.

   Resend is an HTTP API rather than SMTP, which matters here: a serverless
   function can finish a request without holding a mail connection open.

   With no RESEND_API_KEY set, the message is written to the log instead. That
   is a development convenience only — the real path stays wired up, so adding
   the key is the whole of switching it on. */

import { Resend } from 'resend';

const key = process.env.RESEND_API_KEY;
const client = key ? new Resend(key) : null;

export const emailMode = () => (client ? 'resend' : 'console');

export async function sendMail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM || 'jars <onboarding@resend.dev>';

  if (!client) {
    console.log('\n──────── email (not sent — no RESEND_API_KEY) ────────');
    console.log('to:      ' + to);
    console.log('subject: ' + subject);
    console.log(text);
    console.log('──────────────────────────────────────────────────────\n');
    return { mode: 'console' };
  }

  const { error } = await client.emails.send({ from, to, subject, text, html });
  // Don't let a mail failure change what the caller tells the browser: whether
  // an address has an account must not be observable from the reply.
  if (error) console.error('[jars] resend refused the message:', error);
  return { mode: 'resend', error: error || null };
}

export function resetEmail(url, minutes) {
  return {
    subject: 'Reset your jars password',
    text:
      'Someone asked to reset the password on your jars account.\n\n' +
      'Open this link to choose a new one: ' + url + '\n\n' +
      'The link stops working in ' + minutes + ' minutes and can only be used once.\n' +
      "If this wasn't you, ignore this email — nothing has changed.\n",
    html: `
<div style="background:#F9F1E8;padding:34px 18px;font-family:Georgia,'Times New Roman',serif;color:#574144">
  <div style="max-width:460px;margin:0 auto;background:#FFFCF8;border:1px solid rgba(191,126,129,.3);border-radius:4px;padding:32px;text-align:center">
    <p style="margin:0;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.24em;text-transform:uppercase;color:#9A5D61">jars</p>
    <h1 style="font-size:26px;font-weight:500;margin:12px 0 14px">Choose a new password</h1>
    <p style="margin:0 0 22px;font-size:15px;line-height:1.6;color:rgba(87,65,68,.75)">
      Someone asked to reset the password on your account. This link works once,
      and stops working in ${minutes} minutes.
    </p>
    <a href="${url}" style="display:inline-block;padding:13px 30px;border-radius:999px;background:#9A5D61;color:#F9F1E8;text-decoration:none;font-family:Arial,sans-serif;font-size:11px;letter-spacing:.15em;text-transform:uppercase">Set a new password</a>
    <p style="margin:22px 0 0;font-size:12px;line-height:1.6;color:rgba(87,65,68,.55)">
      If this wasn't you, ignore this email — nothing has changed.
    </p>
  </div>
</div>`
  };
}
