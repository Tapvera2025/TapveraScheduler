/**
 * Password helpers
 */

const crypto = require('crypto');

// Deliberately excludes characters that are easy to misread when someone
// copies a password out of an email: O/0, l/1/I, and quotes.
const CHARSET = 'abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*';

/**
 * Generate a random temporary password.
 * Uses crypto rather than Math.random so the value is not predictable.
 */
const generateTempPassword = (length = 14) => {
  const bytes = crypto.randomBytes(length);
  let password = '';

  for (let i = 0; i < length; i += 1) {
    password += CHARSET[bytes[i] % CHARSET.length];
  }

  return password;
};

module.exports = { generateTempPassword };
