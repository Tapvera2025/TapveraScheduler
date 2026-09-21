/**
 * createEmployee — add a person to the organisation.
 *
 * Creates the employee record and their login, and emails them the credentials.
 *
 * It deliberately does not accept a password. A password given to the agent
 * would be typed into a chat box, and from there it reaches the planner, the
 * conversation history replayed to the model on every later turn, the browser's
 * copy of the collected fields, the draft, and the permanent command ledger.
 * None of those are places for a credential, and redacting six of them is
 * weaker than not collecting it. So the service generates the password and
 * emails it to the employee; nothing here ever holds it.
 *
 * An admin who needs to set a specific password does it on the People screen,
 * which validates the request directly and keeps the model out of the path.
 *
 * Four things are genuinely required — first name, last name, email and
 * position — so the planner has to ask for what it was not told rather than
 * inventing a placeholder email.
 */

const employeeService = require('../../services/employee.service');
const Employee = require('../../models/Employee');
const { invalidInput, conflict } = require('../errors');
const { requireStated } = require('../statedValue');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const parameters = {
  type: 'object',
  properties: {
    firstName: { type: 'string', description: 'Given name, e.g. "Darchi". REQUIRED. Omit this field entirely if the admin has not said it — never guess and never send a placeholder.' },
    lastName: { type: 'string', description: 'Family name. REQUIRED - ask for it if the admin only gave one name. Omit this field entirely if the admin has not said it — never guess and never send a placeholder.' },
    email: { type: 'string', description: 'Work email address. REQUIRED and must be a real address - never invent one. Omit this field entirely if the admin has not said it — never guess and never send a placeholder.' },
    position: { type: 'string', description: 'Job title, e.g. "Security Officer". REQUIRED. Omit this field entirely if the admin has not said it — never guess and never send a placeholder.' },
    department: { type: 'string', description: 'Optional department or team.' },
    phone: { type: 'string', description: 'Optional contact number.' },
  },
  additionalProperties: false,
};

/** Shared by both phases, so commit re-checks rather than trusting the preview. */
// One question per field, asked whether the field is absent or was filled in
// with a placeholder — the admin has to answer it either way.
const asked = {
  firstName: 'What is their first name?',
  lastName: 'What is their last name?',
  email: 'What is their email address?',
  position: 'What is their job title?',
};

const build = async (actor, input) => {
  const missing = Object.keys(asked).filter((f) => !input[f]);
  if (missing.length) throw invalidInput(asked[missing[0]], { missing });

  // Every check that needs no database runs first, so a placeholder is turned
  // back into a question without a round-trip.
  const firstName = requireStated(input.firstName, {
    question: asked.firstName, field: 'firstName', nouns: ['first name', 'given name'],
  });
  const lastName = requireStated(input.lastName, {
    question: asked.lastName, field: 'lastName', nouns: ['last name', 'surname', 'family name'],
  });
  const position = requireStated(input.position, {
    question: asked.position, field: 'position', nouns: ['position', 'job title', 'title', 'role'],
  });

  const email = input.email.trim().toLowerCase();
  if (!EMAIL_PATTERN.test(email)) {
    throw invalidInput(`"${input.email}" is not a valid email address`);
  }
  // Basic domain sanity: the part after the last dot should be 2–10 chars.
  // Catches typos like "tapvera.iiiii" early, before the MX check at commit.
  const tld = email.split('.').pop();
  if (!tld || tld.length < 2 || tld.length > 10) {
    throw invalidInput(`"${input.email}" does not look like a valid email domain`);
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
    firstName,
    lastName,
    email,
    position,
    department: input.department?.trim() || undefined,
    phone: input.phone?.trim() || undefined,
  };
};

const prepare = async ({ actor, input }) => {
  const person = await build(actor, input);

  return {
    plan: person,
    preview: {
      action: 'Add employee',
      employee: `${person.firstName} ${person.lastName}`,
      email: person.email,
      position: person.position,
      department: person.department || '—',
      phone: person.phone || '—',
      login: 'Created, with a password emailed to them',
      notes: [
        `A login is created and the credentials are emailed to ${person.email}.`,
        'They will not appear on a roster until assigned to a site.',
      ],
    },
    resolvedEntities: { employee: { name: `${person.firstName} ${person.lastName}` } },
  };
};

const commit = async ({ actor, draft }) => {
  // Someone may have added this person in the meantime.
  const person = await build(actor, draft.input);

  let created;
  try {
    created = await employeeService.createEmployee(
      { companyId: actor.companyId, userId: actor.userId, role: actor.role },
      {
        ...person,
        isActive: true,
        // The service creates the User, generates the password and emails it.
        // No password is passed in and none comes back.
        createLogin: true,
      }
    );
  } catch (err) {
    // Convert service errors (email validation, duplicates, etc.) into
    // AgentErrors so the gateway surfaces the real message instead of a
    // generic "That action could not be completed" (HTTP 500).
    if (err.statusCode === 409) throw conflict(err.message);
    throw invalidInput(err.message || 'Could not create the employee');
  }

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
    "Add a new person to the organisation and create their login. This CHANGES data, so it is previewed first and only created after the admin explicitly confirms. First name, last name, email and job title are all required - ask the admin for anything missing rather than guessing. Never invent an email address. Never ask for a password: the employee's password is generated and emailed to them.",
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: ['firstName', 'lastName', 'email', 'position'],
  parameters,
  prepare,
  commit,
};
