/**
 * updateEmployee — change profile fields on an existing employee.
 *
 * build() is shared by prepare and commit so the world is re-validated at
 * confirmation time. commit re-calls build(actor, draft.input) rather than
 * trusting draft.plan.updates, because the employee or email state may have
 * changed while the preview was on screen.
 */
const employeeService = require('../../services/employee.service');
const Employee = require('../../models/Employee');
const { resolveEmployeeRef } = require('../resolver');
const { invalidInput, conflict } = require('../errors');
const { statedChange } = require('../statedValue');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPDATE_FIELDS = ['firstName', 'lastName', 'email', 'position', 'department', 'phone'];

// What to ask when a field arrives as a placeholder rather than a value. Email
// is absent because its format check already rejects anything that is not one.
const ASK_INSTEAD = {
  firstName: { question: 'What should their first name be?', nouns: ['first name', 'given name'] },
  lastName: { question: 'What should their last name be?', nouns: ['last name', 'surname', 'family name'] },
  position: { question: 'What should their job title be?', nouns: ['position', 'job title', 'title', 'role'] },
  department: { question: 'Which department should they be in?', nouns: ['department', 'team'] },
  phone: { question: 'What is their contact number?', nouns: ['phone', 'number', 'contact'] },
};

const parameters = {
  type: 'object',
  properties: {
    employeeName: { type: 'string', description: 'Full name of the employee to update.' },
    employeeId: { type: 'string', description: 'Opaque employee id from an earlier tool call.' },
    firstName: { type: 'string', description: 'New given name.' },
    lastName: { type: 'string', description: 'New family name.' },
    email: { type: 'string', description: 'New work email address.' },
    position: { type: 'string', description: 'New job title.' },
    department: { type: 'string', description: 'New department or team.' },
    phone: { type: 'string', description: 'New contact number.' },
  },
  additionalProperties: false,
};

const build = async (actor, input) => {
  const employee = await resolveEmployeeRef(actor, input);

  const updates = {};
  for (const f of UPDATE_FIELDS) {
    if (input[f] === undefined || input[f] === null || input[f] === '') continue;
    if (ASK_INSTEAD[f]) {
      const value = statedChange(input[f], { ...ASK_INSTEAD[f], field: f });
      if (value !== undefined) updates[f] = value;
      continue;
    }
    updates[f] = typeof input[f] === 'string' ? input[f].trim() : input[f];
  }

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide at least one field to update (name, email, position, department, or phone).');
  }

  if (updates.email) {
    updates.email = updates.email.toLowerCase();
    if (!EMAIL_PATTERN.test(updates.email)) {
      throw invalidInput(`"${input.email}" is not a valid email address`);
    }
    const existing = await Employee.findOne({
      email: updates.email,
      companyId: actor.companyId,
      _id: { $ne: employee.id },
    }).select('_id firstName lastName').lean();
    if (existing) {
      throw conflict(
        `${existing.firstName} ${existing.lastName} already uses ${updates.email} in your organisation`,
        { employeeId: existing._id.toString() }
      );
    }
  }

  if (updates.email) {
    // Fetch current email — resolveEmployeeRef only returns { id, name }
    const current = await Employee.findOne({ _id: employee.id, companyId: actor.companyId })
      .select('email')
      .lean();
    if (current?.email && updates.email === current.email.toLowerCase()) {
      throw invalidInput(`That is already ${employee.name}'s email address`);
    }
  }

  return { employee, updates };
};

const prepare = async ({ actor, input }) => {
  if (!input.employeeName && !input.employeeId) {
    throw invalidInput('Which employee should I update? Give a name or id.');
  }

  const { employee, updates } = await build(actor, input);

  const notes = [];
  if (updates.email) {
    notes.push('If this employee has a login, their username and a new temporary password will be sent to the new address.');
  }

  return {
    plan: { employeeId: employee.id, updates },
    preview: {
      action: 'Update employee',
      employee: employee.name,
      changes: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
      notes,
    },
    resolvedEntities: { employee },
  };
};

const commit = async ({ actor, draft }) => {
  const { employee, updates } = await build(actor, draft.input);

  await employeeService.updateEmployee(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    employee.id,
    { ...updates }
  );

  return {
    data: { employeeId: employee.id, employee: employee.name, changes: Object.keys(updates) },
    summary: { updated: true, employeeId: employee.id, employee: employee.name },
  };
};

module.exports = {
  name: 'updateEmployee',
  description:
    "Update an employee's profile — change their name, job title, email, phone, or department. This CHANGES data and must be confirmed. Give the employee name or id and at least one field to update.",
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: [],
  parameters,
  prepare,
  commit,
};
