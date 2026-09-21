const test = require('node:test');
const assert = require('node:assert/strict');
const { detectRequestedTool, sanitiseContext, mergeInput } = require('./conversation');

test('recognises explicit current tasks after a roster read', () => {
  const cases = [
    ['Check roster', 'getDailySummary'],
    ['Now add an employee', 'createEmployee'],
    ['I want to add a new staff member', 'createEmployee'],
    ['Could you please create a person named Alice Friday?', 'createEmployee'],
    ['add a shift for Alice tomorrow', 'createShift'],
    ['schedule a shift at Central', 'createShift'],
    ['assign Alice to Central tomorrow', 'createShift'],
    ['roster Alice Jones at Central tomorrow', 'createShift'],
    ['put Alice on a shift', 'createShift'],
    ['add a client', 'createClient'],
    ['create a new site', 'createSite'],
    ['update the employee email', 'updateEmployee'],
    ['edit a site', 'updateSite'],
    ['change the client address', 'updateClient'],
    ['update the shift tomorrow', 'updateShift'],
    ['cancel the shift tomorrow', 'cancelShift'],
    ['deactivate an employee', 'deactivateEmployee'],
    ['show all employees', 'listEmployees'],
    ['how many employees do we have?', 'listEmployees'],
    ['find shifts for Alice', 'findEmployeeShifts'],
    ["show Alice's roster", 'findEmployeeShifts'],
    ['check roster for Alice', 'findEmployeeShifts'],
    ['check roster for today', 'getDailySummary'],
    ["show today's roster", 'getDailySummary'],
    ['who is working today?', 'getDailySummary'],
    ['check attendance for Alice', 'getAttendanceReport'],
  ];
  for (const [text, expected] of cases) assert.equal(detectRequestedTool(text), expected, text);
});

test('does not turn field answers, negations, or compound commands into task switches', () => {
  for (const text of [
    'Shift Supervisor', 'Night Supervisor', 'Roster Manager', 'Alice Friday',
    'alice.friday@example.com', '12 Shift Street', 'Central Site', '09:00',
    'I do not want to add an employee', 'do not cancel the shift',
    'show roster and add an employee', 'add employee and create site',
    'create a shift; cancel the shift', 'add an employee, create another employee',
    'show roster then show employees', '', 'x'.repeat(801), null,
  ]) assert.equal(detectRequestedTool(text), null, String(text));
});

test('context only contains fields of an available operation', () => {
  const tools = [{ function: { name: 'createEmployee', parameters: { properties: {
    firstName: { type: 'string' }, email: { type: 'string' }, phone: { type: 'string' },
    companyId: { type: 'string' }, metadata: { type: 'object' }, flags: { type: 'boolean' },
  } } } }];
  const context = JSON.parse('{"tool":"createEmployee","input":{"firstName":" Alice ","email":"alice@example.com","phone":123456789,"companyId":"other-tenant","userId":"other-user","role":"ADMIN","query":{"isActive":true},"metadata":{"nested":"value"},"flags":true,"__proto__":{"polluted":true},"constructor":"evil","unknown":"ignored"}}');
  const sanitised = sanitiseContext(context, tools);
  assert.equal(sanitised.tool, 'createEmployee');
  assert.deepEqual(sanitised.input, {
    firstName: 'Alice', email: 'alice@example.com', phone: '123456789',
  });
  assert.equal({}.polluted, undefined);
  assert.equal(sanitiseContext({ ...context, tool: 'deleteDatabase' }, tools), null);
  assert.equal(sanitiseContext(context, []), null);
  assert.equal(sanitiseContext(null, tools), null);
  assert.equal(sanitiseContext([], tools), null);
});

test('context rejects oversized, empty, complex, and non-finite values without truncation', () => {
  const properties = Object.fromEntries(['short', 'long', 'empty', 'nested', 'array', 'nan', 'inf', 'bool', 'number'].map((key) => [key, { type: 'string' }]));
  const tools = [{ function: { name: 'tool', parameters: { properties } } }];
  assert.deepEqual(sanitiseContext({ tool: 'tool', input: {
    short: 'x'.repeat(200), long: 'x'.repeat(201), empty: ' ', nested: {}, array: [],
    nan: NaN, inf: Infinity, bool: true, number: 0,
  } }, tools).input, { short: 'x'.repeat(200), number: '0' });
  assert.deepEqual(sanitiseContext({ tool: 'tool', input: [] }, tools).input, {});
});

test('partial input preserves previously collected employee and shift fields', () => {
  assert.deepEqual(mergeInput({ firstName: 'Alice', lastName: 'Friday', email: 'alice@example.com' }, { position: 'Shift Supervisor' }), {
    firstName: 'Alice', lastName: 'Friday', email: 'alice@example.com', position: 'Shift Supervisor',
  });
  assert.deepEqual(mergeInput({ employeeId: 'alice-id', date: '2026-09-18', start: '09:00' }, { end: '17:00', start: '' }), {
    employeeId: 'alice-id', date: '2026-09-18', start: '09:00', end: '17:00',
  });
});

test('corrected names remove stale ids and corrected ids remove stale names', () => {
  for (const entity of ['employee', 'site', 'client', 'shift']) {
    const name = `${entity}Name`;
    const id = `${entity}Id`;
    const previous = { [name]: 'Old', [id]: 'old-id', date: '2026-09-18' };
    assert.deepEqual(mergeInput(previous, { [name]: 'New' }), { [name]: 'New', date: '2026-09-18' });
    assert.deepEqual(mergeInput(previous, { [name]: 'New', [id]: 'old-id' }), { [name]: 'New', date: '2026-09-18' });
    assert.deepEqual(mergeInput(previous, { [id]: 'new-id' }), { [id]: 'new-id', date: '2026-09-18' });
    assert.deepEqual(mergeInput(previous, { [id]: 'new-id', [name]: 'Old' }), { [id]: 'new-id', date: '2026-09-18' });
    assert.deepEqual(mergeInput(previous, { [id]: 'new-id', [name]: 'New' }), { [name]: 'New', [id]: 'new-id', date: '2026-09-18' });
    assert.deepEqual(mergeInput(previous, { [name]: 'Old' }), previous);
  }
});

test('merging never mutates prior inputs or carries privileged fields', () => {
  const previous = Object.freeze({ employeeName: 'Alice', employeeId: 'alice-id', companyId: 'other' });
  const next = Object.freeze({ employeeName: 'Bob', role: 'MASTER' });
  assert.deepEqual(mergeInput(previous, next), { employeeName: 'Bob' });
  assert.equal(previous.employeeId, 'alice-id');
  assert.deepEqual(mergeInput(null, undefined), {});
});
