/**
 * One-off migration: hash plain-text user passwords
 *
 * Password hashing was disabled during development, so existing users may have
 * their password stored as plain text. This script finds those users and
 * replaces the value with a bcrypt hash.
 *
 * It is safe to run more than once — users whose password is already a bcrypt
 * hash are skipped.
 *
 * In development and staging, User.comparePassword upgrades a legacy password
 * to a hash the first time that user logs in, so this script is mainly there
 * for production, where plain-text passwords are refused outright.
 *
 * Usage:
 *   node src/scripts/hashExistingPasswords.js --dry-run   # report only
 *   node src/scripts/hashExistingPasswords.js             # apply
 */

const bcrypt = require('bcryptjs');
const config = require('../config');
const database = require('../config/database');
const User = require('../models/User');

// bcrypt hashes start with $2a$ / $2b$ / $2y$ and are 60 characters long
const BCRYPT_PATTERN = /^\$2[aby]\$\d{2}\$.{53}$/;

const isHashed = (value) => typeof value === 'string' && BCRYPT_PATTERN.test(value);

const run = async () => {
  const dryRun = process.argv.includes('--dry-run');

  await database.connect();
  console.log(`Connected to database "${config.database.dbName}"`);
  console.log(dryRun ? 'Mode: DRY RUN (nothing will be written)\n' : 'Mode: APPLY\n');

  // Include soft-deleted users — they still hold credentials
  const users = await User.find({ deletedAt: { $exists: true } })
    .select('+password')
    .setOptions({ _bypassSoftDelete: true })
    .lean();

  let hashed = 0;
  let skipped = 0;
  let missing = 0;

  for (const user of users) {
    if (!user.password) {
      missing += 1;
      console.log(`  no password  ${user.email}`);
      continue;
    }

    if (isHashed(user.password)) {
      skipped += 1;
      continue;
    }

    if (dryRun) {
      hashed += 1;
      console.log(`  would hash   ${user.email}`);
      continue;
    }

    const salt = await bcrypt.genSalt(config.auth.bcryptSaltRounds);
    const hash = await bcrypt.hash(user.password, salt);

    // Write straight to the collection so the pre-save hook cannot hash twice
    await User.collection.updateOne(
      { _id: user._id },
      { $set: { password: hash, passwordChangedAt: new Date() } }
    );

    hashed += 1;
    console.log(`  hashed       ${user.email}`);
  }

  console.log('\n--- Summary ---');
  console.log(`Users found:        ${users.length}`);
  console.log(`${dryRun ? 'Would hash' : 'Hashed'}:         ${hashed}`);
  console.log(`Already hashed:     ${skipped}`);
  console.log(`No password set:    ${missing}`);

  if (dryRun && hashed > 0) {
    console.log('\nRe-run without --dry-run to apply.');
  }

  await database.disconnect();
  process.exit(0);
};

run().catch(async (error) => {
  console.error('Migration failed:', error.message);
  try {
    await database.disconnect();
  } catch (_) {
    // ignore
  }
  process.exit(1);
});
