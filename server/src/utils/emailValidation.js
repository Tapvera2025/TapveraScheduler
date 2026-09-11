/**
 * Email validation for account creation.
 *
 * Owns four checks so services do not have to reinvent them:
 *
 *   1. Format          — stricter than the model regex; catches "..", leading
 *                        dots, missing TLD, over-length local/domain parts.
 *   2. Disposable      — rejects a curated list of throwaway providers so
 *                        accounts cannot be created for burnable inboxes.
 *   3. Uniqueness      — checks User AND Employee collections in the tenant
 *                        so the same email can never own two roles by mistake.
 *   4. MX deliverability — a DNS MX lookup with a bounded timeout. A missing
 *                        MX record blocks the account; a lookup failure
 *                        (network / timeout) is only logged, never blocks.
 *
 * Returns { ok: true, email } on success (email is normalised: trimmed +
 * lowercased). On failure returns { ok: false, code, message }. Callers turn
 * that into an HTTP error with the code as the machine-readable identifier.
 */

const dns = require('dns').promises;
const logger = require('./logger');

// ─── Curated disposable-domain list ────────────────────────────────────────
// Small on purpose: the point is to stop the obvious ones, not to keep a
// perfect global blocklist. Extend as needed.
const DISPOSABLE_DOMAINS = new Set([
  '10minutemail.com', 'dispostable.com', 'fakeinbox.com', 'getnada.com',
  'guerrillamail.com', 'mailinator.com', 'maildrop.cc', 'mailnesia.com',
  'mytemp.email', 'sharklasers.com', 'temp-mail.org', 'tempmail.com',
  'throwawaymail.com', 'trashmail.com', 'yopmail.com',
]);

// ─── Format ────────────────────────────────────────────────────────────────
// Stricter than the model's /^\S+@\S+\.\S+$/:
//   • local part 1–64 chars, no leading/trailing dot, no double dot
//   • domain labels alphanumeric with hyphens (not at ends)
//   • TLD ≥ 2 alphabetic chars
const FORMAT_RE =
  /^[a-z0-9._%+-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,}$/i;

const normalize = (email) => String(email || '').trim().toLowerCase();

const validateEmailFormat = (email) => {
  const e = normalize(email);
  if (!e) {
    return { ok: false, code: 'MISSING', message: 'An email address is required' };
  }
  if (e.length > 254) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'Email address is too long' };
  }
  const [local, ...rest] = e.split('@');
  const domain = rest.join('@');
  if (!local || !domain || local.length > 64) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'Email address is not valid' };
  }
  if (local.startsWith('.') || local.endsWith('.') || local.includes('..')) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'Email address is not valid' };
  }
  if (!FORMAT_RE.test(e)) {
    return { ok: false, code: 'INVALID_FORMAT', message: 'Email address is not valid' };
  }
  return { ok: true, email: e, domain };
};

const isDisposable = (email) => {
  const f = validateEmailFormat(email);
  return f.ok ? DISPOSABLE_DOMAINS.has(f.domain) : false;
};

// ─── MX record check ───────────────────────────────────────────────────────

const checkDomainMx = async (email, { timeoutMs = 3000 } = {}) => {
  const f = validateEmailFormat(email);
  if (!f.ok) return f;

  let timer;
  try {
    const records = await Promise.race([
      dns.resolveMx(f.domain),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), timeoutMs);
      }),
    ]);
    if (!records || records.length === 0) {
      return {
        ok: false,
        code: 'NO_MX',
        message: `The domain ${f.domain} does not accept email`,
      };
    }
    return { ok: true };
  } catch (err) {
    // Distinguish "the domain cannot receive mail" from "we couldn't check".
    //   ENOTFOUND — domain does not exist
    //   ENODATA   — domain exists but has no MX records
    // Both mean deliverability will fail, so block.
    // Anything else (timeout, network) is soft: DNS blips must not stop
    // admins creating accounts.
    const hard = err.code === 'ENOTFOUND' || err.code === 'ENODATA';
    return {
      ok: false,
      code: hard ? 'NO_MX' : 'MX_LOOKUP_FAILED',
      message: hard
        ? `The domain ${f.domain} does not accept email`
        : `Could not verify email domain (${f.domain})`,
      cause: err.message,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
};

// ─── Cross-collection uniqueness ──────────────────────────────────────────

const checkAccountEmailUnique = async ({
  email,
  companyId,
  excludeUserId,
  excludeEmployeeId,
}) => {
  const User = require('../models/User');
  const Employee = require('../models/Employee');
  const e = normalize(email);
  if (!e) return { ok: false, code: 'MISSING', message: 'An email address is required' };

  const userQuery = { email: e, companyId };
  if (excludeUserId) userQuery._id = { $ne: excludeUserId };

  const employeeQuery = { email: e, companyId };
  if (excludeEmployeeId) employeeQuery._id = { $ne: excludeEmployeeId };

  const [existingUser, existingEmployee] = await Promise.all([
    User.findOne(userQuery).select('_id').lean(),
    Employee.findOne(employeeQuery).select('_id userId').lean(),
  ]);

  if (existingUser) {
    return {
      ok: false,
      code: 'EMAIL_IN_USE',
      message: 'An account with this email already exists in this organisation',
    };
  }
  // Employees may share an email with their own User when the two records are
  // linked (userId set) — that is legitimate, not a collision.
  if (existingEmployee && !excludeUserId && !existingEmployee.userId) {
    return {
      ok: false,
      code: 'EMAIL_IN_USE',
      message: 'An employee with this email already exists in this organisation',
    };
  }
  return { ok: true };
};

// ─── The one call services should use ─────────────────────────────────────

/**
 * Runs all checks in the order that gives the most useful first error:
 * format → disposable → uniqueness → MX. MX check is skipped in test env or
 * when explicitly disabled by the caller.
 */
const validateAccountEmail = async ({
  email,
  companyId,
  checkDisposable = true,
  checkMx = process.env.NODE_ENV !== 'test',
  excludeUserId,
  excludeEmployeeId,
}) => {
  const format = validateEmailFormat(email);
  if (!format.ok) return format;

  if (checkDisposable && DISPOSABLE_DOMAINS.has(format.domain)) {
    return {
      ok: false,
      code: 'DISPOSABLE_DOMAIN',
      message: 'Disposable email addresses are not allowed for accounts',
    };
  }

  const uniqueness = await checkAccountEmailUnique({
    email: format.email,
    companyId,
    excludeUserId,
    excludeEmployeeId,
  });
  if (!uniqueness.ok) return uniqueness;

  if (checkMx) {
    const mx = await checkDomainMx(format.email);
    if (!mx.ok && mx.code === 'NO_MX') return mx;
    if (!mx.ok && mx.code === 'MX_LOOKUP_FAILED') {
      logger.warn('MX lookup failed (allowing account creation)', {
        email: format.email,
        cause: mx.cause,
      });
    }
  }

  return { ok: true, email: format.email };
};

module.exports = {
  DISPOSABLE_DOMAINS,
  normalize,
  validateEmailFormat,
  isDisposable,
  checkDomainMx,
  checkAccountEmailUnique,
  validateAccountEmail,
};
