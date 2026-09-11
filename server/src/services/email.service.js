/**
 * Email Service
 *
 * All transactional email for the platform. Templates share one visual system
 * (see `renderEmail`) so every message looks like it came from the same
 * product. Callers use the higher-level helpers (`sendWelcomeEmail` etc.)
 * rather than assembling HTML themselves.
 *
 * BCC-to-admin: when an employee-facing email is sent, the admins of that
 * employee's company are automatically BCC'd so managers stay in the loop
 * without a separate digest. Password reset is exempt (would leak the token).
 */

const nodemailer = require('nodemailer');
const config = require('../config');
const logger = require('../utils/logger');

// ─── Design tokens ─────────────────────────────────────────────────────────
//
// One place to change if the brand ever shifts. Values are inlined into each
// template since email clients strip <style> blocks and do not support CSS
// custom properties.

const BRAND = {
  primary:      '#a44d28', // rust — the app's brand accent
  primaryDark:  '#7f351c',
  primarySoft:  '#fbefe9',
  success:      '#246b47',
  successSoft:  '#eef7f0',
  warning:      '#98500a',
  warningSoft:  '#fff5e8',
  error:        '#ab3030',
  errorSoft:    '#fff0f0',
  info:         '#2a5d8b',
  infoSoft:     '#eef5fb',
  text:         '#241f1b',
  textSecondary:'#5b5049',
  textMuted:    '#746861',
  background:   '#f7f4f0',
  card:         '#ffffff',
  border:       '#e5dcd3',
  divider:      '#eee7e1',
};

const FONT_STACK =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", "Helvetica Neue", Arial, sans-serif';

const appName = () => config.app?.name || 'Tapvera Scheduler';
const loginUrl = () => config.app?.clientUrl || 'http://localhost:5173';

const escapeHtml = (value = '') => String(value)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const formatMessage = (message = '') => {
  const paragraphs = String(message)
    .trim()
    .split(/\r?\n\s*\r?\n/)
    .filter(Boolean);

  return paragraphs
    .map((paragraph) => `<p style="margin: 0 0 14px;">${escapeHtml(paragraph).replace(/\r?\n/g, '<br>')}</p>`)
    .join('') || '<p style="margin: 0;"></p>';
};

// ─── The shared layout ─────────────────────────────────────────────────────

/**
 * Render a full transactional email. All optional pieces are omitted cleanly
 * when not provided so each template only sets what it needs.
 *
 * @param {Object} opts
 * @param {String} opts.preheader     Hidden preview text shown by mail clients
 * @param {String} opts.title         The bold headline in the message body
 * @param {String} opts.greeting      e.g. "Hello Archi,"
 * @param {String} opts.intro         HTML paragraph — the opening explanation
 * @param {Object} [opts.card]        Boxed key/value block (rows: [[label, value], ...], tone)
 * @param {Object} [opts.callout]     Highlighted note ({ text, tone })
 * @param {Object} [opts.cta]         Primary action button ({ text, url })
 * @param {Object} [opts.secondaryCta] Optional secondary link ({ text, url })
 * @param {String} [opts.supportNote] Trailing "if you need help…" line
 * @param {String} [opts.reference]   Small reference id under the footer
 */
const renderEmail = ({
  preheader = '',
  eyebrow = 'OPERATIONS & ROSTERING',
  title,
  greeting,
  intro,
  card,
  callout,
  cta,
  secondaryCta,
  supportNote,
  reference,
} = {}) => {
  const tone = (t) => {
    const map = {
      brand:   { fg: BRAND.primaryDark, bg: BRAND.primarySoft, border: '#e9cbbb' },
      success: { fg: BRAND.success,     bg: BRAND.successSoft, border: '#cce4d4' },
      warning: { fg: BRAND.warning,     bg: BRAND.warningSoft, border: '#f0d9b7' },
      error:   { fg: BRAND.error,       bg: BRAND.errorSoft,   border: '#efcccc' },
      info:    { fg: BRAND.info,        bg: BRAND.infoSoft,    border: '#cfdfef' },
      neutral: { fg: BRAND.textSecondary, bg: '#fbfaf8',        border: BRAND.border },
    };
    return map[t] || map.brand;
  };

  const spacer = (height) => `
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      <tr><td height="${height}" style="height: ${height}px; line-height: ${height}px; font-size: 1px;">&nbsp;</td></tr>
    </table>`;

  const safeTitle = title ? escapeHtml(title) : '';
  const safeGreeting = greeting ? escapeHtml(greeting) : '';
  const safeAppName = escapeHtml(appName());

  const cardBlock = card ? (() => {
    const t = tone(card.tone || 'brand');
    const rowData = (card.rows || [])
      .filter(([, value]) => value !== null && value !== undefined && value !== '');
    const rows = rowData
      .map(([label, value], index) => `
        <tr>
          <td class="email-detail-label" style="width: 34%; padding: 11px 16px 11px 0; border-bottom: ${index < rowData.length - 1 ? `1px solid ${t.border}` : '0'}; font-size: 11px; line-height: 1.45; font-weight: 700; letter-spacing: 0.075em; text-transform: uppercase; color: ${BRAND.textMuted}; vertical-align: top;">${escapeHtml(label)}</td>
          <td class="email-detail-value" style="padding: 11px 0; border-bottom: ${index < rowData.length - 1 ? `1px solid ${t.border}` : '0'}; font-size: 14px; line-height: 1.55; font-weight: 600; color: ${BRAND.text}; vertical-align: top; word-break: break-word;">${value}</td>
        </tr>`)
      .join('');
    return `
    ${spacer(24)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
      <tr>
        <td style="padding: 22px 24px; background: ${t.bg}; border: 1px solid ${t.border}; border-left: 4px solid ${t.fg}; border-radius: 10px;">
          ${card.title ? `<div style="margin: 0 0 10px; font-size: 11px; line-height: 1.35; font-weight: 800; letter-spacing: 0.11em; text-transform: uppercase; color: ${t.fg};">${escapeHtml(card.title)}</div>` : ''}
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">${rows}</table>
        </td>
      </tr>
    </table>`;
  })() : '';

  const calloutBlock = callout ? (() => {
    const t = tone(callout.tone || 'warning');
    return `
    ${spacer(card ? 18 : 24)}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: separate;">
      <tr>
        <td style="padding: 0; background: ${t.bg}; border: 1px solid ${t.border}; border-radius: 8px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
            <tr>
              <td width="4" style="width: 4px; background: ${t.fg}; font-size: 1px; line-height: 1px;">&nbsp;</td>
              <td style="padding: 15px 18px 16px; font-size: 13px; line-height: 1.6; color: ${BRAND.textSecondary};">
                ${callout.title ? `<div style="margin: 0 0 4px; font-size: 12px; font-weight: 800; letter-spacing: 0.03em; color: ${t.fg};">${escapeHtml(callout.title)}</div>` : ''}
                <div>${callout.text}</div>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>`;
  })() : '';

  const ctaBlock = cta ? `
    ${spacer(28)}
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
      <tr>
        <td align="center" bgcolor="${BRAND.primary}" style="border-radius: 8px; background: ${BRAND.primary};">
          <!--[if mso]>
          <v:roundrect xmlns:v="urn:schemas-microsoft-com:vml" href="${escapeHtml(cta.url)}" style="height: 48px; v-text-anchor: middle; width: 236px;" arcsize="17%" strokecolor="${BRAND.primary}" fillcolor="${BRAND.primary}">
            <w:anchorlock/>
            <center style="color: #ffffff; font-family: Arial, sans-serif; font-size: 14px; font-weight: 700;">${escapeHtml(cta.text)}</center>
          </v:roundrect>
          <![endif]-->
          <!--[if !mso]><!-->
          <a href="${escapeHtml(cta.url)}" target="_blank" style="display: inline-block; padding: 14px 24px; border: 1px solid ${BRAND.primary}; border-radius: 8px; color: #ffffff; background: ${BRAND.primary}; text-decoration: none; font-family: ${FONT_STACK}; font-size: 14px; font-weight: 700; line-height: 20px; letter-spacing: 0.01em;">
            ${escapeHtml(cta.text)}
          </a>
          <!--<![endif]-->
        </td>
      </tr>
    </table>` : '';

  const secondaryCtaBlock = secondaryCta ? `
    ${spacer(12)}
    <p style="margin: 0; font-size: 13px; line-height: 1.55; color: ${BRAND.textMuted};">
      Or <a href="${escapeHtml(secondaryCta.url)}" style="color: ${BRAND.primaryDark}; font-weight: 700; text-decoration: underline; text-underline-offset: 2px;">${escapeHtml(secondaryCta.text)}</a>
    </p>` : '';

  const supportBlock = supportNote ? `
    ${spacer(30)}
    <p style="margin: 0; font-size: 13px; line-height: 1.65; color: ${BRAND.textMuted};">
      ${escapeHtml(supportNote)}
    </p>` : '';

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light">
  <meta name="supported-color-schemes" content="light">
  <title>${safeTitle || safeAppName}</title>
  <style>
    @media screen and (max-width: 620px) {
      .email-outer { padding: 16px 10px !important; }
      .email-header { padding: 24px 22px !important; }
      .email-body { padding: 30px 22px 28px !important; }
      .email-footer { padding: 22px !important; }
      .email-detail-label, .email-detail-value { display: block !important; box-sizing: border-box !important; width: 100% !important; }
      .email-detail-label { padding: 10px 0 2px !important; border-bottom: 0 !important; }
      .email-detail-value { padding: 2px 0 10px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background: ${BRAND.background}; font-family: ${FONT_STACK}; -webkit-font-smoothing: antialiased;">
  ${preheader ? `<div style="display: none; overflow: hidden; max-height: 0; max-width: 0; opacity: 0; color: transparent; font-size: 1px; line-height: 1px; mso-hide: all;">${escapeHtml(preheader)}&nbsp;&zwnj;&nbsp;&zwnj;&nbsp;&zwnj;</div>` : ''}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.background}" style="border-collapse: collapse; background: ${BRAND.background};">
    <tr>
      <td class="email-outer" align="center" style="padding: 36px 16px;">
        <table class="email-container" role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" bgcolor="${BRAND.card}" style="width: 100%; max-width: 600px; border-collapse: separate; background: ${BRAND.card}; border: 1px solid ${BRAND.border}; border-radius: 14px; overflow: hidden; box-shadow: 0 12px 30px rgba(58, 42, 29, 0.08);">

          <!-- Header -->
          <tr>
            <td class="email-header" bgcolor="${BRAND.primary}" style="padding: 27px 32px 25px; background: ${BRAND.primary};">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse: collapse;">
                <tr>
                  <td style="font-size: 21px; line-height: 1.15; font-weight: 800; letter-spacing: -0.025em; color: #ffffff;">
                    ${safeAppName}
                  </td>
                  <td align="right" style="padding-left: 18px; font-size: 10px; line-height: 1.3; font-weight: 700; letter-spacing: 0.13em; text-transform: uppercase; color: #f9dbcd; white-space: nowrap;">
                    ${escapeHtml(eyebrow)}
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Body -->
          <tr>
            <td class="email-body" style="padding: 40px 36px 36px; background: ${BRAND.card};">
              ${safeTitle ? `<h1 style="margin: 0 0 18px; font-size: 26px; line-height: 1.22; font-weight: 800; color: ${BRAND.text}; letter-spacing: -0.035em;">${safeTitle}</h1>` : ''}
              ${safeGreeting ? `<p style="margin: 0 0 14px; font-size: 15px; line-height: 1.6; color: ${BRAND.text}; font-weight: 700;">${safeGreeting}</p>` : ''}
              ${intro ? `<div style="margin: 0; font-size: 15px; line-height: 1.7; color: ${BRAND.textSecondary};">${intro}</div>` : ''}
              ${cardBlock}
              ${calloutBlock}
              ${ctaBlock}
              ${secondaryCtaBlock}
              ${supportBlock}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td class="email-footer" bgcolor="${BRAND.background}" style="padding: 24px 32px; background: ${BRAND.background}; border-top: 1px solid ${BRAND.border};">
              <p style="margin: 0; font-size: 12px; line-height: 1.65; color: ${BRAND.textMuted}; text-align: center;">
                Sent by <strong style="color: ${BRAND.textSecondary};">${safeAppName}</strong><br>
                This is an automated account or roster update.
              </p>
              ${reference ? `<p style="margin: 7px 0 0; font-size: 11px; color: ${BRAND.textMuted}; text-align: center; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;">Reference ${escapeHtml(reference)}</p>` : ''}
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
};

// ─── Service ───────────────────────────────────────────────────────────────

class EmailService {
  constructor() {
    this.transporter = null;
    this.isEnabled = config.email?.enabled || false;
    this.from = config.email?.from || 'noreply@rostermechanic.com';

    if (this.isEnabled) {
      this.initializeTransporter();
    }
  }

  initializeTransporter() {
    try {
      if (config.email.service === 'gmail') {
        this.transporter = nodemailer.createTransport({
          service: 'gmail',
          auth: {
            user: config.email.user,
            pass: config.email.password,
          },
        });
      } else if (config.email.service === 'ses') {
        this.transporter = nodemailer.createTransport({
          host: config.email.host || `email.${config.email.region || 'ap-southeast-2'}.amazonaws.com`,
          port: config.email.port || 587,
          secure: false,
          auth: {
            user: config.email.accessKey,
            pass: config.email.secretKey,
          },
        });
      } else {
        this.transporter = nodemailer.createTransport({
          host: config.email.host,
          port: config.email.port || 587,
          secure: config.email.secure || false,
          auth: {
            user: config.email.user,
            pass: config.email.password,
          },
        });
      }

      logger.info('Email service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize email service:', error);
      this.isEnabled = false;
    }
  }

  /**
   * Find admin email addresses to BCC on emails for a given recipient. Looks
   * up the recipient by email in User + Employee collections; if either
   * matches, finds ADMIN users in that company. Excludes the recipient itself
   * so admins do not receive their own outgoing mail.
   *
   * Silently returns [] on any lookup failure — BCC is a best-effort courtesy
   * copy, never a delivery blocker.
   */
  async _resolveAdminBcc({ recipientEmail, companyId }) {
    try {
      let cid = companyId;
      if (!cid && recipientEmail) {
        const User = require('../models/User');
        const Employee = require('../models/Employee');
        const [u, e] = await Promise.all([
          User.findOne({ email: recipientEmail }).select('companyId').lean(),
          Employee.findOne({ email: recipientEmail }).select('companyId').lean(),
        ]);
        cid = u?.companyId || e?.companyId;
      }
      if (!cid) return [];

      const User = require('../models/User');
      const admins = await User.find({
        companyId: cid,
        role: 'ADMIN',
        isActive: { $ne: false },
      })
        .select('email')
        .lean();

      const recipientLower = (recipientEmail || '').toLowerCase();
      return admins
        .map((a) => a.email)
        .filter((addr) => addr && addr.toLowerCase() !== recipientLower);
    } catch (err) {
      logger.warn('Admin BCC lookup failed; sending without BCC', { error: err.message });
      return [];
    }
  }

  /**
   * Send an email. Callers may pass `bcc: 'auto'` (or omit) to have admins for
   * the recipient's company automatically BCC'd. Pass `bcc: null` to opt out
   * (used by password reset).
   */
  async sendEmail({ to, subject, html, text, attachments = [], bcc = 'auto', companyId }) {
    if (!this.isEnabled) {
      logger.warn('Email service is disabled. Email not sent:', { to, subject });
      return { success: false, message: 'Email service is disabled' };
    }

    let bccList = [];
    if (bcc === 'auto') {
      bccList = await this._resolveAdminBcc({ recipientEmail: to, companyId });
    } else if (Array.isArray(bcc)) {
      bccList = bcc.filter(Boolean);
    } else if (typeof bcc === 'string' && bcc) {
      bccList = [bcc];
    }

    try {
      const mailOptions = {
        from: this.from,
        to,
        subject,
        html,
        text: text || this.stripHtml(html),
        attachments,
      };
      if (bccList.length) mailOptions.bcc = bccList;

      const info = await this.transporter.sendMail(mailOptions);

      logger.info('Email sent successfully:', {
        to,
        bcc: bccList.length || 0,
        subject,
        messageId: info.messageId,
      });

      return {
        success: true,
        messageId: info.messageId,
        message: 'Email sent successfully',
      };
    } catch (error) {
      logger.error('Failed to send email:', {
        to,
        subject,
        error: error.message,
      });
      throw error;
    }
  }

  // ── Welcome ──────────────────────────────────────────────────────────────

  async sendWelcomeEmail({ to, name, email, password, role, companyName, companyId }) {
    const subject = `Welcome to ${appName()}`;
    const roleLabel =
      role === 'ADMIN' ? 'Administrator'
      : role === 'MANAGER' ? 'Manager'
      : role === 'USER' ? 'Team member'
      : role || 'Team member';

    const html = renderEmail({
      preheader: `Your ${appName()} account is ready. Sign in with the credentials inside.`,
      title: `Welcome${name ? `, ${name.split(' ')[0]}` : ''}.`,
      greeting: name ? `Hello ${name},` : 'Hello,',
      intro: `
        <p style="margin: 0 0 14px;">
          Your account with <strong style="color: ${BRAND.text};">${companyName || appName()}</strong>
          has been created. You can sign in with the credentials below.
        </p>
        <p style="margin: 0;">
          After your first sign-in you will be prompted to change this password to
          something only you know.
        </p>
      `,
      card: {
        tone: 'brand',
        title: 'Your sign-in details',
        rows: [
          ['Email', email],
          ['Temporary password', `<code style="padding: 2px 8px; background: ${BRAND.card}; border: 1px solid ${BRAND.border}; border-radius: 4px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 13px;">${password}</code>`],
          ['Role', roleLabel],
          companyName ? ['Organisation', companyName] : null,
        ].filter(Boolean),
      },
      callout: {
        tone: 'warning',
        text: `<strong style="color: ${BRAND.text};">Change your password on first login.</strong> Anyone with this temporary password could access your account until you do.`,
      },
      cta: { text: 'Sign in to your account', url: loginUrl() },
      supportNote: `If you were not expecting this email, please contact your administrator or reply to let us know.`,
    });

    return this.sendEmail({ to, subject, html, companyId });
  }

  // ── Password reset ──────────────────────────────────────────────────────
  //
  // Never BCC admins on this one — the reset link is a live credential.

  async sendPasswordResetEmail({ to, name, resetToken, expiresIn = 60 }) {
    const subject = 'Reset your password';
    const resetUrl = `${loginUrl()}/reset-password?token=${resetToken}`;

    const html = renderEmail({
      preheader: `Use this link within ${expiresIn} minutes to set a new password.`,
      title: 'Reset your password',
      greeting: name ? `Hello ${name},` : 'Hello,',
      intro: `
        <p style="margin: 0;">
          We received a request to reset the password on your ${appName()} account.
          Click the button below to choose a new one. This link will expire in
          <strong style="color: ${BRAND.text};">${expiresIn} minutes</strong>.
        </p>
      `,
      cta: { text: 'Set a new password', url: resetUrl },
      callout: {
        tone: 'error',
        text: `If you did not request a password reset, you can safely ignore this email — your current password will keep working.`,
      },
      supportNote: `For security, this link only works once and is tied to your account.`,
    });

    return this.sendEmail({ to, subject, html, bcc: null });
  }

  // ── Generic notification ─────────────────────────────────────────────────

  async sendNotificationEmail({ to, subject, message, actionUrl, actionText, companyId, tone = 'brand' }) {
    const html = renderEmail({
      preheader: subject,
      title: subject,
      greeting: 'Hello,',
      intro: `<p style="margin: 0;">${message}</p>`,
      cta: actionUrl && actionText ? { text: actionText, url: actionUrl } : undefined,
      supportNote: `You can view your dashboard at any time by signing in at ${appName()}.`,
    });

    return this.sendEmail({ to, subject, html, companyId });
  }

  // ── Shift assignment ─────────────────────────────────────────────────────

  async sendShiftAssignmentEmail({
    to,
    employeeName,
    siteName,
    shiftDate,
    startTime,
    endTime,
    shiftType,
    notes,
    isAdhoc = false,
    companyId,
  }) {
    const subject = isAdhoc
      ? `Adhoc shift assigned — ${shiftDate}`
      : `New shift scheduled — ${shiftDate}`;

    const shiftTypeLabel = shiftType || 'Regular';

    const html = renderEmail({
      preheader: `${siteName} · ${shiftDate} · ${startTime} – ${endTime}`,
      title: isAdhoc ? 'New adhoc shift' : 'New shift on your roster',
      greeting: employeeName ? `Hello ${employeeName},` : 'Hello,',
      intro: isAdhoc
        ? `<p style="margin: 0;">An adhoc shift has been added to your roster. Please review the details below and let your manager know if you are unable to cover it.</p>`
        : `<p style="margin: 0;">A shift has been scheduled for you. The details are below — please arrive a few minutes early.</p>`,
      card: {
        tone: isAdhoc ? 'warning' : 'success',
        title: 'Shift details',
        rows: [
          ['Site', siteName],
          ['Date', shiftDate],
          ['Time', `${startTime} – ${endTime}`],
          ['Type', shiftTypeLabel],
          notes ? ['Notes', notes] : null,
        ].filter(Boolean),
      },
      cta: { text: 'View my roster', url: `${loginUrl()}/user/roster` },
      supportNote: `If you cannot make this shift, contact your manager as soon as possible so cover can be arranged.`,
    });

    return this.sendEmail({ to, subject, html, companyId });
  }

  // ── Shift reminder (1 hour before) ──────────────────────────────────────

  async sendShiftReminderEmail({
    to,
    employeeName,
    siteName,
    shiftDate,
    startTime,
    endTime,
    minutesUntilStart,
    companyId,
  }) {
    const subject = `Reminder: shift at ${startTime} today`;
    const html = renderEmail({
      preheader: `You're on at ${siteName} in about ${minutesUntilStart || 60} minutes.`,
      title: 'Your shift starts soon',
      greeting: employeeName ? `Hello ${employeeName},` : 'Hello,',
      intro: `<p style="margin: 0;">This is a friendly reminder that your shift starts in about <strong style="color: ${BRAND.text};">${minutesUntilStart || 60} minutes</strong>. Please allow enough time to arrive, sign in, and be ready to start on time.</p>`,
      card: {
        tone: 'brand',
        title: 'Shift details',
        rows: [
          ['Site', siteName],
          ['Date', shiftDate],
          ['Time', `${startTime} – ${endTime}`],
        ],
      },
      cta: { text: 'View my roster', url: `${loginUrl()}/user/roster` },
      supportNote: `If something has come up and you cannot make it, please contact your manager immediately so cover can be arranged.`,
    });
    return this.sendEmail({ to, subject, html, companyId });
  }

  // ── Shift absence (no clock-in) ─────────────────────────────────────────

  async sendShiftAbsenceEmail({
    to,
    employeeName,
    siteName,
    shiftDate,
    startTime,
    endTime,
    companyId,
  }) {
    const subject = `Missed shift: ${siteName} · ${shiftDate}`;
    const html = renderEmail({
      preheader: `You did not clock in for the ${startTime} shift at ${siteName}.`,
      title: 'You were not clocked in for your shift',
      greeting: employeeName ? `Hello ${employeeName},` : 'Hello,',
      intro: `<p style="margin: 0;">Our records show you were rostered on for a shift today but were not clocked in by start time. The shift has been flagged as a no-show. If this was a mistake, please reach out to your manager as soon as possible so it can be corrected on your record.</p>`,
      card: {
        tone: 'error',
        title: 'Missed shift',
        rows: [
          ['Site', siteName],
          ['Date', shiftDate],
          ['Scheduled time', `${startTime} – ${endTime}`],
          ['Status', 'No-show'],
        ],
      },
      callout: {
        tone: 'warning',
        text: `<strong style="color: ${BRAND.text};">Repeated no-shows may affect your standing on the roster.</strong> If you were unwell or had an emergency, contact your manager to have this reviewed.`,
      },
      cta: { text: 'Contact your manager', url: `${loginUrl()}/user/roster` },
    });
    return this.sendEmail({ to, subject, html, companyId });
  }

  // ── Leave decision (approved / declined) ────────────────────────────────

  async sendLeaveDecisionEmail({
    to,
    employeeName,
    decision, // 'approved' | 'declined'
    leaveType,
    startDate,
    endDate,
    days,
    actionNote,
    companyId,
  }) {
    const approved = decision === 'approved';
    const subject = approved
      ? `Your leave request has been approved`
      : `Your leave request has been declined`;

    const typeLabel = {
      annual: 'Annual leave',
      sick: 'Sick leave',
      personal: 'Personal leave',
      unpaid: 'Unpaid leave',
    }[leaveType] || (leaveType || 'Leave');

    const html = renderEmail({
      preheader: approved
        ? `Your ${typeLabel.toLowerCase()} for ${startDate} – ${endDate} has been approved.`
        : `Your ${typeLabel.toLowerCase()} for ${startDate} – ${endDate} was not approved.`,
      title: approved ? 'Leave approved' : 'Leave declined',
      greeting: employeeName ? `Hello ${employeeName},` : 'Hello,',
      intro: approved
        ? `<p style="margin: 0;">Good news — your leave request has been approved. Enjoy the time off.</p>`
        : `<p style="margin: 0;">Your leave request has not been approved on this occasion. Please review the details and reach out to your manager if you would like to discuss it.</p>`,
      card: {
        tone: approved ? 'success' : 'error',
        title: approved ? 'Approved leave' : 'Declined request',
        rows: [
          ['Type', typeLabel],
          ['Period', `${startDate} – ${endDate}`],
          days != null ? ['Days', `${days} day${days === 1 ? '' : 's'}`] : null,
          actionNote ? ['Note from your manager', actionNote] : null,
        ].filter(Boolean),
      },
      cta: { text: 'View my leave requests', url: `${loginUrl()}/user/leave` },
      supportNote: approved
        ? `If any details are incorrect, contact your manager as soon as possible so this can be updated.`
        : `If you have questions about this decision, please speak with your manager directly.`,
    });

    return this.sendEmail({ to, subject, html, companyId });
  }

  // ── Leave request submitted (admin-facing) ──────────────────────────────

  async sendLeaveRequestEmail({
    to,
    employeeName,
    leaveType,
    startDate,
    endDate,
    days,
    notes,
    actionUrl,
  }) {
    const typeLabel = {
      annual: 'Annual leave',
      sick: 'Sick leave',
      personal: 'Personal leave',
      unpaid: 'Unpaid leave',
    }[leaveType] || (leaveType || 'Leave');

    const subject = `Leave request from ${employeeName || 'an employee'} · ${startDate}`;

    const html = renderEmail({
      preheader: `${employeeName} has requested ${typeLabel.toLowerCase()} for ${startDate} – ${endDate}.`,
      title: 'New leave request',
      greeting: 'Hello,',
      intro: `<p style="margin: 0;">A new leave request has been submitted and is awaiting your review.</p>`,
      card: {
        tone: 'brand',
        title: 'Request details',
        rows: [
          ['Employee', employeeName],
          ['Type', typeLabel],
          ['Period', `${startDate} – ${endDate}`],
          days != null ? ['Days', `${days} day${days === 1 ? '' : 's'}`] : null,
          notes ? ['Employee note', notes] : null,
        ].filter(Boolean),
      },
      cta: { text: 'Review this request', url: actionUrl || `${loginUrl()}/leave` },
      supportNote: `Approving or declining a request will notify the employee automatically.`,
    });

    // Admin-facing — no BCC (the recipient IS the admin).
    return this.sendEmail({ to, subject, html, bcc: null });
  }

  // ── Utility ─────────────────────────────────────────────────────────────

  stripHtml(html) {
    return html
      .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
      .replace(/<[^>]*>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  async verifyConnection() {
    if (!this.isEnabled || !this.transporter) return false;
    try {
      await this.transporter.verify();
      logger.info('Email service connection verified');
      return true;
    } catch (error) {
      logger.error('Email service connection failed:', error);
      return false;
    }
  }
}

module.exports = new EmailService();
