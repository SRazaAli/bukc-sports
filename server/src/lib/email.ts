/**
 * Email behind a single interface. `console` provider just logs (offline dev),
 * `resend` sends via Resend's API, `smtp` sends via any real mail account
 * (Gmail, Outlook, a university mailbox...) using nodemailer — free, no
 * domain purchase required, and delivers to any real recipient (unlike
 * Resend's free tier without a verified domain, which only delivers to the
 * Resend account's own registered email). Production can add another
 * provider here without touching any feature code — every NOTIF email calls
 * `sendEmail`.
 */
import nodemailer from 'nodemailer';
import { config } from '../config/index.js';

export interface EmailMessage {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

interface EmailProvider {
  send(msg: EmailMessage): Promise<void>;
}

const consoleProvider: EmailProvider = {
  async send(msg) {
    console.log(`[email:console] to=${msg.to} subject="${msg.subject}"`);
    console.log(msg.text ?? msg.html.replace(/<[^>]+>/g, ''));
  },
};

const resendProvider: EmailProvider = {
  async send(msg) {
    if (!config.RESEND_API_KEY) {
      throw new Error('RESEND_API_KEY not set but EMAIL_PROVIDER=resend');
    }
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: config.EMAIL_FROM,
        to: msg.to,
        subject: msg.subject,
        html: msg.html,
        text: msg.text,
      }),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`Resend send failed (${res.status}): ${detail}`);
    }
  },
};

// Lazily constructed so a missing config doesn't throw at import time when
// EMAIL_PROVIDER isn't 'smtp' — config.ts already validates the required
// vars are present before this ever runs when it IS selected.
let smtpTransport: ReturnType<typeof nodemailer.createTransport> | null = null;
function getSmtpTransport() {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: config.SMTP_HOST,
      port: config.SMTP_PORT,
      secure: config.SMTP_PORT === 465, // 465 = implicit TLS, 587 = STARTTLS
      auth: { user: config.SMTP_USER, pass: config.SMTP_PASS },
    });
  }
  return smtpTransport;
}

const smtpProvider: EmailProvider = {
  async send(msg) {
    await getSmtpTransport().sendMail({
      from: config.EMAIL_FROM,
      to: msg.to,
      subject: msg.subject,
      html: msg.html,
      text: msg.text,
    });
  },
};

const provider: EmailProvider =
  config.EMAIL_PROVIDER === 'resend' ? resendProvider :
  config.EMAIL_PROVIDER === 'smtp' ? smtpProvider :
  consoleProvider;

export function sendEmail(msg: EmailMessage): Promise<void> {
  // NOTIF-03: email is best-effort. We never let a failed email break a request;
  // callers await this but wrap in a try/catch or fire-and-forget as appropriate.
  return provider.send(msg);
}
