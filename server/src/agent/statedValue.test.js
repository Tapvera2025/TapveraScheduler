const test = require('node:test');
const assert = require('node:assert/strict');
const { isPlaceholder, requireStated, statedChange } = require('./statedValue');
const { CODES } = require('./errors');

test('a stand-in for an answer is not an answer', () => {
  // "?" is what a model sends when a field is marked REQUIRED and it was never
  // told the value. Accepting it put a client called "?" one tap from existing.
  for (const value of [
    '?', '??', '-', '--', '...', ' ', '',
    'N/A', 'n/a', 'NA', 'nil', 'none', 'null', 'undefined',
    'TBD', 'tba', 'todo', 'unknown', 'unspecified', 'placeholder', 'missing',
    'name', 'string', 'xxx', 'asdf',
  ]) {
    assert.equal(isPlaceholder(value), true, JSON.stringify(value));
  }
});

test('the field name echoed back is not an answer either', () => {
  for (const value of ['client', 'a client', 'A Client', 'the client', 'new client', 'clientName', 'customer']) {
    assert.equal(isPlaceholder(value, ['client', 'customer']), true, JSON.stringify(value));
  }
  // The same words are fine when they are part of a real name.
  assert.equal(isPlaceholder('Client Services Pty Ltd', ['client']), false);
  assert.equal(isPlaceholder('Customer First Group', ['client', 'customer']), false);
});

test('real names are left alone, however short or punctuated', () => {
  // A false rejection blocks a genuine record, which is the worse failure.
  for (const value of [
    '3M', 'BP', 'H&M', 'Ola', "O'Brien & Sons", 'Tapvera', 'ABC Radio',
    'Sample Co', 'Foo Industries', 'St. John Ambulance', 'Site 4',
    'ग्राहक', '大阪商会', 'Ürün A.Ş.',
  ]) {
    assert.equal(isPlaceholder(value, ['client', 'site']), false, JSON.stringify(value));
  }
});

test('requireStated returns the trimmed value or asks the question', () => {
  assert.equal(requireStated('  Tapvera  ', { question: 'q', field: 'clientName' }), 'Tapvera');

  for (const value of [undefined, null, '', '   ', '?', 'unknown']) {
    assert.throws(
      () => requireStated(value, { question: 'What is the client called?', field: 'clientName' }),
      (err) => {
        // INVALID_INPUT so the client shows it as a prompt, not a failure, and
        // names the outstanding field so the planner can keep collecting.
        assert.equal(err.code, CODES.INVALID_INPUT);
        assert.equal(err.message, 'What is the client called?');
        assert.deepEqual(err.details.missing, ['clientName']);
        return true;
      },
      JSON.stringify(value)
    );
  }
});

test('a write tool turns a placeholder back into a question', async () => {
  const createClient = require('./tools/createClient');
  const actor = { companyId: 'company-1', userId: 'user-1', role: 'ADMIN' };

  // Reaching a database query would mean the cheap checks ran too late; these
  // all have to be refused before any lookup.
  for (const input of [{}, { clientName: '?' }, { clientName: 'a client' }, { clientName: 'N/A' }]) {
    await assert.rejects(
      () => createClient.prepare({ actor, input }),
      (err) => {
        assert.equal(err.code, CODES.INVALID_INPUT);
        assert.equal(err.message, 'What is the client called?');
        return true;
      },
      JSON.stringify(input)
    );
  }
});

test('an update leaves a field alone when nothing was given', () => {
  const opts = { question: 'What should the client be called?', field: 'newName' };

  // No value means no change, which is a normal outcome for an update.
  for (const value of [undefined, null, '', '   ']) {
    assert.equal(statedChange(value, opts), undefined, JSON.stringify(value));
  }
  assert.equal(statedChange('  Acme Ltd  ', opts), 'Acme Ltd');
});

test('an update refuses to overwrite a real value with a placeholder', () => {
  // Worse than creating junk: something correct would be lost.
  const opts = { question: 'What should the client be called?', field: 'newName', nouns: ['client'] };

  for (const value of ['?', 'N/A', 'unknown', 'client', 'the client']) {
    assert.throws(
      () => statedChange(value, opts),
      (err) => {
        assert.equal(err.code, CODES.INVALID_INPUT);
        assert.equal(err.message, 'What should the client be called?');
        return true;
      },
      JSON.stringify(value)
    );
  }
});
