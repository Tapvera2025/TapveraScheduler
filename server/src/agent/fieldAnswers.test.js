const test = require('node:test');
const assert = require('node:assert/strict');
const {
  detectRequestedTool,
  isBareCommand,
  simpleAnswer,
  sanitiseContext,
} = require('./conversation');

// The shape availableTools() returns, reduced to what these helpers read.
const TOOLS = [
  {
    kind: 'write',
    function: {
      name: 'createSite',
      parameters: {
        properties: {
          siteLocationName: { type: 'string' },
          shortName: { type: 'string' },
          clientName: { type: 'string' },
          clientId: { type: 'string' },
        },
      },
    },
  },
];

test('a bare command has nothing to extract', () => {
  for (const text of [
    'add a site', 'create a client', 'add an employee', 'register a new person',
    'Please add a site.', 'add a shift',
  ]) {
    assert.equal(isBareCommand(text), true, text);
  }
});

test('a command carrying detail is left to the planner', () => {
  for (const text of [
    'add a site called North Gate',
    'create a client named Vyasa IAS in NSW',
    'add an employee Aman Khan as a guard',
  ]) {
    assert.equal(isBareCommand(text), false, text);
  }
});

test('a plain value is read as the answer to the question just asked', () => {
  for (const text of ['Australia', 'North Gate', 'NG', 'Vyasa IAS', 'Security Officer', 'B4']) {
    assert.equal(simpleAnswer(text), text, text);
  }
  assert.equal(simpleAnswer('  North Gate  '), 'North Gate');
});

test('steering the conversation is not answering the question', () => {
  // "cancel" is a perfectly good short string, and without this guard it
  // becomes the site's short code.
  for (const text of ['cancel', 'Cancel.', 'stop', 'no', 'never mind', 'ok', 'confirm', 'undo', 'skip']) {
    assert.equal(simpleAnswer(text), null, text);
  }
});

test('a message doing more than answering goes to the planner', () => {
  for (const text of [
    'North Gate, code NG',
    'North Gate with code NG',
    'a site called North Gate',
    'add a client',
    'x'.repeat(61),
  ]) {
    assert.equal(simpleAnswer(text), null, text);
  }
});

test('the outstanding field survives the trip through the browser', () => {
  const kept = sanitiseContext(
    { tool: 'createSite', input: { siteLocationName: 'Australia' }, awaiting: 'shortName' },
    TOOLS
  );
  assert.equal(kept.awaiting, 'shortName');
  assert.deepEqual(kept.input, { siteLocationName: 'Australia' });

  // Only a real field of that tool counts, so nothing the browser sends can
  // widen what may be written.
  for (const awaiting of ['companyId', 'role', 'notAField', '', 42, null, undefined]) {
    const sanitised = sanitiseContext({ tool: 'createSite', input: {}, awaiting }, TOOLS);
    assert.equal(sanitised.awaiting, null, JSON.stringify(awaiting));
  }
});

test('the whole add-a-site conversation resolves without the planner', () => {
  // Turn 1: the command itself. Nothing to extract, so the tool runs with no
  // input and asks for its own first field.
  assert.equal(detectRequestedTool('add a site'), 'createSite');
  assert.equal(isBareCommand('add a site'), true);

  // Turn 2 onwards: each answer goes into the field the tool named, and the
  // collected fields carry forward.
  let context = { tool: 'createSite', input: {}, awaiting: 'siteLocationName' };
  const answers = [['Australia', 'shortName'], ['NG', 'clientName']];

  for (const [reply, nextField] of answers) {
    const pending = sanitiseContext(context, TOOLS);
    const answer = simpleAnswer(reply);
    assert.ok(answer, reply);
    assert.equal(detectRequestedTool(reply), null, `${reply} must not look like a new command`);

    context = {
      tool: pending.tool,
      input: { ...pending.input, [pending.awaiting]: answer },
      awaiting: nextField,
    };
  }

  assert.deepEqual(context.input, { siteLocationName: 'Australia', shortName: 'NG' });
  assert.equal(context.awaiting, 'clientName');
});
