const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS, RESERVED_KEYS } = require('./registry');

// Anything a tool declares can be typed into the chat, and from there it
// reaches the planner, the history replayed to the model each turn, the
// browser's copy of the collected fields, the draft and the command ledger.
// Nothing secret belongs in that set.
const SECRET_ISH = /pass(word|phrase)|secret|token|apikey|api_key|credential|otp|pin$/i;

test('no tool asks for a credential', () => {
  for (const tool of TOOLS) {
    for (const field of Object.keys(tool.parameters?.properties || {})) {
      assert.doesNotMatch(field, SECRET_ISH, `${tool.name}.${field}`);
    }
    for (const field of tool.required || []) {
      assert.doesNotMatch(field, SECRET_ISH, `${tool.name} requires ${field}`);
    }
  }
});

test('every declared field is a string the gateway will accept', () => {
  // sanitiseInput rejects anything that is not a string, so a boolean or
  // number in a schema is a field the tool can never actually receive.
  for (const tool of TOOLS) {
    const props = tool.parameters?.properties || {};
    for (const [field, schema] of Object.entries(props)) {
      assert.equal(schema.type, 'string', `${tool.name}.${field} is ${schema.type}`);
    }
  }
});

test('no tool declares a field the gateway strips as privileged', () => {
  for (const tool of TOOLS) {
    for (const field of Object.keys(tool.parameters?.properties || {})) {
      assert.ok(!RESERVED_KEYS.includes(field), `${tool.name}.${field} is reserved`);
    }
  }
});

test('every required field is one the tool actually declares', () => {
  for (const tool of TOOLS) {
    const props = Object.keys(tool.parameters?.properties || {});
    for (const field of tool.required || []) {
      assert.ok(props.includes(field), `${tool.name} requires undeclared ${field}`);
    }
  }
});

// ─── Pickers must be able to complete ──────────────────────────────────────
//
// Choosing from a list sends the entity's id back and blanks the name
// (useAgent.chooseCandidate). The gateway then drops every field the tool does
// not declare. So a tool that asks for a name but declares no matching id
// receives a retry with neither, asks the same question again, and the admin
// is in a loop they cannot get out of by clicking.

// createClient.clientName is the name of the client being created, not a
// reference to one that exists, so there is no id to choose. A tool is exempt
// for exactly the entity it creates.
const namesItsOwn = (tool, entity) =>
  tool.name.toLowerCase() === `create${entity}`.toLowerCase();

const sanitiseLikeGateway = (tool, raw) => {
  const allowed = Object.keys(tool.parameters?.properties || {});
  const clean = {};
  for (const [key, value] of Object.entries(raw)) {
    if (RESERVED_KEYS.includes(key) || !allowed.includes(key)) continue;
    if (value === null || value === undefined || value === '') continue;
    clean[key] = String(value).trim();
  }
  return clean;
};

test('a tool that takes an entity name also takes its id', () => {
  for (const tool of TOOLS) {
    const fields = Object.keys(tool.parameters?.properties || {});
    for (const entity of ['employee', 'site', 'client', 'shift']) {
      if (!fields.includes(`${entity}Name`) || namesItsOwn(tool, entity)) continue;
      assert.ok(
        fields.includes(`${entity}Id`),
        `${tool.name} accepts ${entity}Name but not ${entity}Id, so choosing from a list cannot complete`
      );
    }
  }
});

test('a chosen entity survives the trip back through the gateway', () => {
  const chosenId = 'a'.repeat(24);

  for (const tool of TOOLS) {
    const fields = Object.keys(tool.parameters?.properties || {});
    for (const entity of ['employee', 'site', 'client', 'shift']) {
      if (!fields.includes(`${entity}Name`) || namesItsOwn(tool, entity)) continue;

      const afterClick = {
        ...Object.fromEntries(tool.required.map((f) => [f, 'given'])),
        [`${entity}Id`]: chosenId,
        [`${entity}Name`]: '',
      };
      const arrives = sanitiseLikeGateway(tool, afterClick);

      assert.equal(arrives[`${entity}Id`], chosenId, `${tool.name} loses the chosen ${entity}`);
      assert.equal(arrives[`${entity}Name`], undefined, `${tool.name} keeps a blanked ${entity}Name`);
    }
  }
});
