/**
 * Create the platform master admin
 *
 * The master admin sits above all organisations: it creates them, decides which
 * modules each one may use, and issues their first admin's credentials. It has
 * no companyId and no access to any organisation's own data.
 *
 * Usage:
 *   node src/scripts/createMasterUser.js --email you@example.com --name "Your Name"
 *   node src/scripts/createMasterUser.js --email you@example.com --name "Your Name" --password "own-password"
 *   node src/scripts/createMasterUser.js --email second@example.com --name "Second" --force
 *
 * With no --password a strong one is generated and printed once. It is never
 * shown again, so copy it before closing the terminal.
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

const run = async () => {
  const email = (readFlag('email') || process.env.MASTER_EMAIL || '').trim().toLowerCase();
  const name = readFlag('name') || process.env.MASTER_NAME || 'Master Admin';
  const suppliedPassword = readFlag('password') || process.env.MASTER_PASSWORD;
  const force = process.argv.includes('--force');

  if (!email) {
    console.error('An email is required:  --email you@example.com');
    process.exit(1);
  }

  if (suppliedPassword && suppliedPassword.length < 8) {
    console.error('Password must be at least 8 characters.');
    process.exit(1);
  }

  await database.connect();

  const existingMaster = await User.findOne({ role: 'MASTER' }).lean();

  if (existingMaster && !force) {
    console.error(
      `A master admin already exists (${existingMaster.email}).\n` +
      'Pass --force if you really want a second one.'
    );
    await database.disconnect();
    process.exit(1);
  }

  const clash = await User.findOne({ email }).select('_id role').lean();

  if (clash) {
    console.error(`A user with the email ${email} already exists (role: ${clash.role}).`);
    await database.disconnect();
    process.exit(1);
  }

  const password = suppliedPassword || generateTempPassword();

  // The pre-save hook hashes this before it reaches the database
  const master = await User.create({
    email,
    name,
    password,
    role: 'MASTER',
    isActive: true,
  });

  console.log('\nMaster admin created.\n');
  console.log(`  Name:     ${master.name}`);
  console.log(`  Email:    ${master.email}`);

  if (suppliedPassword) {
    console.log('  Password: (the one you supplied)');
  } else {
    console.log(`  Password: ${password}`);
    console.log('\n  Copy this password now — it is not stored anywhere in readable form.');
  }

  console.log('\nSign in at /login and you will land on the master panel.\n');

  await database.disconnect();
  process.exit(0);
};

run().catch(async (error) => {
  console.error('Could not create the master admin:', error.message);
  try {
    await database.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
