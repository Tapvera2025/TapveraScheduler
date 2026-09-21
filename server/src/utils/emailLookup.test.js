const test = require('node:test');
const assert = require('node:assert/strict');

// Loaded lazily: the controller pulls in config and models, which is fine here
// but should not happen at require time for the whole test directory.
const { strippedEmail } = require('../controllers/auth.controller');

test('the fallback form matches how addresses used to be stored', () => {
  // normalizeEmail() stripped dots and +tags from the local part on the way in,
  // and folded googlemail onto gmail. Sign-in has to be able to find those.
  assert.equal(strippedEmail('archi.dutta@gmail.com'), 'archidutta@gmail.com');
  assert.equal(strippedEmail('archi+work@gmail.com'), 'archi@gmail.com');
  assert.equal(strippedEmail('a.b+tag@googlemail.com'), 'ab@gmail.com');
});

test('an address with nothing to strip is returned unchanged', () => {
  // The controller only runs the second query when the form actually differs,
  // so these cost no extra lookup.
  for (const e of ['sahil@tapvera.io', 'archi@gmail.com', 'first@sub.domain.co']) {
    assert.equal(strippedEmail(e), e);
  }
});

test('the domain is never altered apart from the googlemail alias', () => {
  assert.equal(strippedEmail('a.b@tapvera.io'), 'ab@tapvera.io');
  assert.equal(strippedEmail('a.b@my.gmail.com.au'), 'ab@my.gmail.com.au');
});

test('malformed input is passed straight through rather than throwing', () => {
  for (const e of ['', 'nope', '@gmail.com', '.@gmail.com', null, undefined]) {
    assert.doesNotThrow(() => strippedEmail(e));
  }
  assert.equal(strippedEmail('@gmail.com'), '@gmail.com');
  assert.equal(strippedEmail('.@gmail.com'), '.@gmail.com');
});
