/**
 * createEmployee — add a person to the organisation.
 *
 * Deliberately creates the employee RECORD only. It does not set a password,
 * does not mint a login, and does not send an invitation. Issuing someone
 * credentials by voice is a different decision from adding them to a roster,
 * and it should be made deliberately from the People screen rather than as a
 * side effect of a spoken sentence.
 *
 * Four things are genuinely required — first name, last name, email and
 * position — so the planner has to ask for what it was not told rather than
 * inventing a placeholder email.
 */

const employeeService = require('../../services/employee.service');
const Employee = require('../../models/Employee');
const { invalidInput, conflict } = require('../errors');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parameters = {
  type: 'object',
  properties: {
    firstName: { type: 'string', description: 'Given name, e.g. "Darchi".' },
    lastName: { type: 'string', description: 'Family name. REQUIRED - ask for it if the admin only gave one name.' },
    email: { type: 'string', description: 'Work email address. REQUIRED and must be a real address - never invent one.' },
    position: { type: 'string', description: 'Job title, e.g. "Security Officer". REQUIRED - ask if not stated.' },
    department: { type: 'string', description: 'Optional department or team.' },
    phone: { type: 'string', description: 'Optional contact number.' },
  },
  additionalProperties: false,
};

/** Shared by both phases, so commit re-checks rather than trusting the preview. */
const build = async (actor, input) => {
  const missing = ['firstName', 'lastName', 'email', 'position'].filter((f) => !input[f]);

  if (missing.length) {
    const asked = {
      firstName: 'What is their first name?',
      lastName: 'What is their last name?',
      email: 'What is their email address?',
      position: 'What is their job title?',
    };
    throw invalidInput(asked[missing[0]], { missing });
  }

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw invalidInput(`"${input.email}" is not a valid email address`);
  }

  // Unique per company in the schema; check here so the preview can explain it
  // rather than failing at the last moment.
  const existing = await Employee.findOne({ email, companyId: actor.companyId })
    .select('_id firstName lastName')
    .lean();

  if (existing) {
    throw conflict(
      `${existing.firstName} ${existing.lastName} already uses ${email} in your organisation`,
      { employeeId: existing._id.toString() }
    );
  }

  return {
    firstName: input.firstName.trim(),
    lastName: input.lastName.trim(),
    email,
    position: input.position.trim(),
    department: input.department?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
  };
};

const prepare = async ({ actor, input }) => {
  const person = await build(actor, input);

  return {
    plan: { ...person },
    preview: {
      action: 'Add employee',
      employee: `${person.firstName} ${person.lastName}`,
      email: person.email,
      position: person.position,
      department: person.department || '—',
      phone: person.phone || '—',
      notes: [
        'No login is created. Invite them from the People screen when they need access.',
        'They will not appear on a roster until assigned to a site.',
      ],
    },
    resolvedEntities: { employee: { name: `${person.firstName} ${person.lastName}` } },
  };
};

const commit = async ({ actor, draft }) => {
  // Someone may have added this person in the meantime.
  const person = await build(actor, draft.input);

  const created = await employeeService.createEmployee(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    {
      ...person,
      isActive: true,
      // No password, so no User account is created. See the note at the top.
    }
  );

  const id = (created?._id || created?.id || '').toString();

  return {
    data: {
      employeeId: id,
      employee: { id, name: `${person.firstName} ${person.lastName}` },
      email: person.email,
      position: person.position,
      department: person.department || null,
    },
    summary: {
      created: true,
      employeeId: id,
      employee: `${person.firstName} ${person.lastName}`,
      position: person.position,
    },
  };
};

module.exports = {
  name: 'createEmployee',
  description:
    "Add a new person to the organisation. This CHANGES data, so it is previewed first and only created after the admin explicitly confirms. First name, last name, email and job title are all required - ask the admin for anything missing rather than guessing, and never invent an email address. This does not create a login for them.",
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: ['firstName', 'lastName', 'email', 'position'],
  parameters,
  prepare,
  commit,
};
