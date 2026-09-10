/**
 * Reset a user's password from the command line
 *
 * For when nobody can sign in: a forgotten master admin password, or an
 * organisation admin whose credentials were never emailed because the mail
 * service was switched off.
 *
 * The new password is set through the model, so the normal pre-save hook hashes
 * it and stamps passwordChangedAt - which invalidates any token issued before
 * the reset. Nothing is written in readable form.
 *
 * Usage:
 *   node src/scripts/resetPassword.js --email master@rostermechanic.dev
 *   node src/scripts/resetPassword.js --email someone@example.com --password "own-password"
 *   node src/scripts/resetPassword.js --email someone@example.com --activate
 *
 * With no --password a strong one is generated and printed once. Copy it before
 * closing the terminal; it cannot be recovered afterwards.
 */

const database = require('../config/database');
const User = require('../models/User');
const { generateTempPassword } = require('../utils/password');

const readFlag = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  return value && !value.startsWith('--') ? value : undefined;
};

const MIN_LENGTH = 8;

const run = async () => {
  const email = (readFlag('email') || process.env.RESET_EMAIL || '').trim().toLowerCase();
  const suppliedPassword = readFlag('password') || process.env.RESET_PASSWORD;
  const activate = process.argv.includes('--activate');

  if (!email) {
    console.error('An email is required:  --email someone@example.com');
    process.exit(1);
  }

  if (suppliedPassword && suppliedPassword.length < MIN_LENGTH) {
    console.error(`A supplied password must be at least ${MIN_LENGTH} characters.`);
    process.exit(1);
  }

  await database.connect();

  // Select the password field explicitly: the schema hides it by default.
  const user = await User.findOne({ email }).select('+password');

  if (!user) {
    console.error(`No user found with the email ${email}.`);
    const others = await User.find({}).select('email role').limit(10).lean();
    if (others.length) {
      console.error('\nAccounts that do exist:');
      others.forEach((u) => console.error(`  ${u.email}  (${u.role})`));
    }
    await database.disconnect();
    process.exit(1);
  }

  const password = suppliedPassword || generateTempPassword();

  user.password = password;
  if (activate) user.isActive = true;

  // save(), not updateOne(): the hashing hook only runs on save.
  await user.save();

  console.log('\nPassword reset.\n');
  console.log(`  Email:    ${user.email}`);
  console.log(`  Role:     ${user.role}`);
  console.log(`  Active:   ${user.isActive !== false ? 'yes' : 'no  <-- cannot sign in; rerun with --activate'}`);

  if (suppliedPassword) {
    console.log('  Password: (the one you supplied)');
  } else {
    console.log(`  Password: ${password}`);
    console.log('\n  Copy this password now — it is not stored anywhere in readable form.');
  }

  console.log('\nAny session issued before this reset is now invalid.\n');

  await database.disconnect();
  process.exit(0);
};

run().catch(async (error) => {
  console.error('Could not reset the password:', error.message);
  try {
    await database.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
