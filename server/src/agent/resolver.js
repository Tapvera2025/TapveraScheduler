/**
 * Entity resolution.
 *
 * The language model never decides which person or site a spoken name refers
 * to. It passes the words it heard; this module matches them against the
 * authenticated tenant's own records and returns either exactly one match or an
 * explicit ambiguity for the admin to settle. There is no "best guess" path,
 * because the cost of picking the wrong Alam Khan is a real shift on a real
 * person's roster.
 *
 * Projections here are deliberately narrow. Candidates that go back to the
 * planner carry an opaque id and enough to tell two people apart — never email,
 * phone, address, pay or location history.
 */

const mongoose = require('mongoose');
const Employee = require('../models/Employee');
const Site = require('../models/Site');
const Client = require('../models/Client');
const { invalidInput, notFound, ambiguous } = require('./errors');

const MAX_CANDIDATES = 8;

/** Escape a user-spoken string so it can never act as a regex. */
const literal = (value) => String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const normalise = (value) => String(value || '').trim().replace(/\s+/g, ' ');

const employeeLabel = (e) => [e.firstName, e.lastName].filter(Boolean).join(' ');

/** What the planner is allowed to see about a candidate. */
const employeeCandidate = (e) => ({
  id: e._id.toString(),
  name: employeeLabel(e),
  position: e.position || null,
  department: e.department || null,
});

const siteCandidate = (s) => ({
  id: s._id.toString(),
  name: s.siteLocationName,
  shortName: s.shortName || null,
  timezone: s.timezone || null,
});

/**
 * Resolve free text to exactly one active employee in the actor's company.
 * @param {Object} actor - { companyId }
 * @param {String} ref   - what the admin said, e.g. "Alam Khan"
 */
const resolveEmployee = async (actor, ref) => {
  const term = normalise(ref);
  if (term.length < 2) {
    throw invalidInput('Please give at least two characters of the employee name');
  }

  const { companyId } = actor;
  const base = { companyId, isActive: true };
  const rx = (pattern) => new RegExp(pattern, 'i');
  const parts = term.split(' ');

  // Tightest match first. Only fall outwards when the tighter pass found nobody,
  // so a precise full name is never diluted by loose partial matches.
  const passes = [];

  if (parts.length > 1) {
    const first = literal(parts[0]);
    const last = literal(parts.slice(1).join(' '));
    passes.push({
      ...base,
      firstName: rx(`^${first}$`),
      lastName: rx(`^${last}$`),
    });
    passes.push({
      ...base,
      firstName: rx(`^${first}`),
      lastName: rx(`^${last}`),
    });
  } else {
    const only = literal(term);
    passes.push({
      ...base,
      $or: [{ firstName: rx(`^${only}$`) }, { lastName: rx(`^${only}$`) }],
    });
    passes.push({
      ...base,
      $or: [{ firstName: rx(`^${only}`) }, { lastName: rx(`^${only}`) }],
    });
    passes.push({
      ...base,
      $or: [{ firstName: rx(literal(only)) }, { lastName: rx(literal(only)) }],
    });
  }

  for (const query of passes) {
    const found = await Employee.find(query)
      .select('_id firstName lastName position department')
      .limit(MAX_CANDIDATES + 1)
      .lean();

    if (found.length === 1) {
      return { id: found[0]._id.toString(), name: employeeLabel(found[0]) };
    }

    if (found.length > 1) {
      throw ambiguous(
        `More than one employee matches "${term}". Which one did you mean?`,
        { entity: 'employee', term, candidates: found.slice(0, MAX_CANDIDATES).map(employeeCandidate) }
      );
    }
  }

  throw notFound(`No active employee in your organisation matches "${term}"`, {
    entity: 'employee',
    term,
  });
};

/**
 * Resolve free text to exactly one active site in the actor's company.
 */
const resolveSite = async (actor, ref) => {
  const term = normalise(ref);
  if (term.length < 2) {
    throw invalidInput('Please give at least two characters of the site name');
  }

  const { companyId } = actor;
  const base = { companyId, status: 'ACTIVE' };
  const only = literal(term);
  const rx = (pattern) => new RegExp(pattern, 'i');

  const passes = [
    { ...base, $or: [{ siteLocationName: rx(`^${only}$`) }, { shortName: rx(`^${only}$`) }] },
    { ...base, $or: [{ siteLocationName: rx(`^${only}`) }, { shortName: rx(`^${only}`) }] },
    { ...base, $or: [{ siteLocationName: rx(only) }, { shortName: rx(only) }] },
  ];

  for (const query of passes) {
    const found = await Site.find(query)
      .select('_id siteLocationName shortName timezone')
      .limit(MAX_CANDIDATES + 1)
      .lean();

    if (found.length === 1) {
      const site = found[0];
      return {
        id: site._id.toString(),
        name: site.siteLocationName,
        timezone: site.timezone || null,
      };
    }

    if (found.length > 1) {
      throw ambiguous(
        `More than one site matches "${term}". Which one did you mean?`,
        { entity: 'site', term, candidates: found.slice(0, MAX_CANDIDATES).map(siteCandidate) }
      );
    }
  }

  throw notFound(`No active site in your organisation matches "${term}"`, {
    entity: 'site',
    term,
  });
};

/**
 * Accept either an already-resolved opaque id (from a previous turn) or free
 * text. An id is still verified against the tenant before it is trusted.
 */
const resolveEmployeeRef = async (actor, { employeeId, employeeName }) => {
  if (employeeId) {
    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      throw invalidInput('That employee reference is not valid');
    }
    const employee = await Employee.findOne({
      _id: employeeId,
      companyId: actor.companyId,
    })
      .select('_id firstName lastName')
      .lean();

    if (!employee) {
      throw notFound('That employee is not in your organisation', { entity: 'employee' });
    }
    return { id: employee._id.toString(), name: employeeLabel(employee) };
  }

  if (employeeName) return resolveEmployee(actor, employeeName);

  throw invalidInput('Which employee? Give a name.', { missing: ['employeeName'] });
};

/**
 * Resolve free text to exactly one active client in the actor's company.
 * A site stores its client as a name, so this returns the canonical spelling
 * rather than whatever the admin happened to say.
 */
const resolveClient = async (actor, ref) => {
  const term = normalise(ref);
  if (term.length < 2) {
    throw invalidInput('Please give at least two characters of the client name');
  }

  const base = { companyId: actor.companyId, status: { $ne: 'INACTIVE' } };
  const only = literal(term);
  const rx = (pattern) => new RegExp(pattern, 'i');

  const passes = [
    { ...base, clientName: rx(`^${only}$`) },
    { ...base, clientName: rx(`^${only}`) },
    { ...base, clientName: rx(only) },
  ];

  for (const query of passes) {
    const found = await Client.find(query)
      .select('_id clientName state')
      .limit(MAX_CANDIDATES + 1)
      .lean();

    if (found.length === 1) {
      return { id: found[0]._id.toString(), name: found[0].clientName };
    }

    if (found.length > 1) {
      throw ambiguous(`More than one client matches "${term}". Which one did you mean?`, {
        entity: 'client',
        term,
        candidates: found.slice(0, MAX_CANDIDATES).map((c) => ({
          id: c._id.toString(),
          name: c.clientName,
          state: c.state || null,
        })),
      });
    }
  }

  throw notFound(`No client named "${term}". Add the client first, then the site.`, {
    entity: 'client',
    term,
  });
};

module.exports = {
  resolveEmployee,
  resolveSite,
  resolveClient,
  resolveEmployeeRef,
  employeeCandidate,
  siteCandidate,
};
