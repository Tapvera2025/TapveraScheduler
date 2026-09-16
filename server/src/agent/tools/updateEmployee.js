const employeeService = require('../../services/employee.service');
const Employee = require('../../models/Employee');
const { resolveEmployeeRef } = require('../resolver');
const { invalidInput, conflict } = require('../errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const UPDATE_FIELDS = ['firstName', 'lastName', 'email', 'position', 'department', 'phone'];

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
    if (input[f] !== undefined && input[f] !== null && input[f] !== '') {
      updates[f] = typeof input[f] === 'string' ? input[f].trim() : input[f];
    }
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

  return { employee, updates };
};

const prepare = async ({ actor, input }) => {
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
