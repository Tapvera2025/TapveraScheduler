const test = require('node:test');
const assert = require('node:assert/strict');
const emailService = require('./email.service');

const EMPLOYEE = 'aman@example.com';
const TEMP_PASSWORD = 'Xk4-temp-pass';

/** Run a helper with sendEmail stubbed, and return what it was asked to send. */
const capture = async (run) => {
  const calls = [];
  const original = emailService.sendEmail;
  emailService.sendEmail = async (options) => {
    calls.push(options);
    return { success: true };
  };
  try {
    await run();
  } finally {
    emailService.sendEmail = original;
  }
  return calls;
};

const welcome = () =>
  emailService.sendWelcomeEmail({
    to: EMPLOYEE,
    name: 'Aman Verma',
    email: EMPLOYEE,
    password: TEMP_PASSWORD,
    role: 'USER',
    companyName: 'Tapvera',
    companyId: 'company-1',
  });

test('an email carrying a password is never blind-copied to admins', async () => {
  // sendEmail defaults bcc to 'auto', which copies every ADMIN in the
  // organisation. For these two the body is a working credential, so the
  // courtesy copy would hand one admin somebody else's account.
  const calls = await capture(async () => {
    await welcome();
    await emailService.sendPasswordResetEmail({
      to: EMPLOYEE,
      name: 'Aman Verma',
      resetToken: 'reset-token',
    });
  });

  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.equal(call.bcc, null, `${call.subject} must opt out of the admin BCC`);
  }
});

test('the welcome email is addressed to the employee', async () => {
  const [call] = await capture(welcome);

  assert.equal(call.to, EMPLOYEE);
  assert.ok(call.html.includes(TEMP_PASSWORD), 'the credentials belong in the body');
  assert.ok(call.html.includes('Hello Aman Verma'), 'and it greets the employee');
});

test('the welcome email does not promise a prompt the app never shows', async () => {
  // There is no forced-password-change flow, so the copy has to ask rather
  // than claim the app will ask.
  const [call] = await capture(welcome);

  assert.doesNotMatch(call.html, /will be prompted/i);
  assert.match(call.html, /change this password/i);
});

test('operational emails keep the admin courtesy copy', async () => {
  // Nothing here is a credential, so "keep managers in the loop" still applies.
  const calls = await capture(() =>
    emailService.sendNotificationEmail({
      to: EMPLOYEE,
      subject: 'Roster published',
      message: 'Your shifts for next week are up.',
      companyId: 'company-1',
    })
  );

  assert.equal(calls.length, 1);
  assert.equal(calls[0].bcc, undefined, 'left at the auto default');
});
