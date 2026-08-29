// Email is sent through nodemailer when SMTP is configured, and printed to the
// server console when it isn't. The console adapter is for development only —
// the real transport stays wired up, so adding the EMAIL_* variables is all
// that's needed to switch a provider on.

import nodemailer from 'nodemailer';

let transport = null;
let mode = 'console';

if (process.env.EMAIL_HOST && process.env.EMAIL_USER) {
  transport = nodemailer.createTransport({
    host: process.env.EMAIL_HOST,
    port: Number(process.env.EMAIL_PORT) || 587,
    secure: Number(process.env.EMAIL_PORT) === 465,
    auth: { user: process.env.EMAIL_USER, pass: process.env.EMAIL_PASSWORD }
  });
  mode = 'smtp';
}

export const emailMode = () => mode;

export async function sendMail({ to, subject, text, html }) {
  const from = process.env.EMAIL_FROM || 'jars <no-reply@jars.local>';

  if (mode === 'console') {
    console.log('\n──────── email (not sent — SMTP not configured) ────────');
    console.log(`to:      ${to}`);
    console.log(`subject: ${subject}`);
    console.log(text);
    console.log('────────────────────────────────────────────────────────\n');
    return { delivered: false, mode };
  }

  await transport.sendMail({ from, to, subject, text, html });
  return { delivered: true, mode };
}

export function resetEmail(resetUrl, minutes) {
  const text = [
    'Someone asked to reset the password on your jars account.',
    '',
    `Open this link to choose a new one: ${resetUrl}`,
    '',
    `The link stops working in ${minutes} minutes and can only be used once.`,
    "If this wasn't you, ignore this email — nothing has changed."
  ].join('\n');

  const html = `
  <div style="background:#F9F1E8;padding:34px;font-family:Georgia,'Times New Roman',serif;color:#574144">
    <p style="letter-spacing:.24em;text-transform:uppercase;font-size:11px;color:#9A5D61;margin:0 0 10px">jars</p>
    <h1 style="font-weight:500;font-size:26px;margin:0 0 14px">Reset your password</h1>
    <p style="margin:0 0 20px;line-height:1.6">Someone asked to reset the password on your jars account. Choose a new one here:</p>
    <p style="margin:0 0 24px">
      <a href="${resetUrl}" style="display:inline-block;background:#9A5D61;color:#F9F1E8;text-decoration:none;padding:13px 26px;border-radius:999px;font-family:Helvetica,Arial,sans-serif;font-size:12px;letter-spacing:.14em;text-transform:uppercase">Reset password</a>
    </p>
    <p style="margin:0 0 8px;color:#8E767A;font-size:14px">This link expires in ${minutes} minutes and works only once.</p>
    <p style="margin:0;color:#8E767A;font-size:14px">If you didn't ask for this, ignore this email — nothing has changed.</p>
  </div>`;

  return { subject: 'Reset your jars password', text, html };
}
