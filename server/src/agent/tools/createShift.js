/**
 * createShift — the first write the agent may perform.
 *
 * Two-phase by design. `prepare` resolves everything, checks every invariant it
 * can, and returns a preview without touching the database. `commit` re-checks
 * the world (which may have moved while a person was reading the preview) and
 * only then writes, through the existing scheduler service so notifications and
 * document audit still happen exactly as they do for the UI.
 *
 * A missing end time is asked for, never defaulted. There is no company-wide
 * eight-hour assumption in this codebase to fall back on, and inventing one
 * would put a real person on a roster for hours nobody chose.
 */

const schedulerService = require('../../services/scheduler.service');
const Employee = require('../../models/Employee');
const Site = require('../../models/Site');
const { resolveEmployeeRef, resolveSite } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { shiftInstants, findConflicts, assertSiteAssignment } = require('../scheduling');
const { invalidInput, notFound, conflict } = require('../errors');

const SHIFT_TYPES = ['REGULAR', 'OVERTIME', 'ON_CALL', 'NIGHT'];

const parameters = {
  type: 'object',
  properties: {
    employeeName: { type: 'string', description: 'The employee as the admin said it, e.g. "Alam Khan".' },
    employeeId: { type: 'string', description: 'An opaque employee id from an earlier tool call. Never invent one.' },
    siteName: { type: 'string', description: 'The site as the admin said it, e.g. "Westfield".' },
    siteId: { type: 'string', description: 'An opaque site id from an earlier tool call. Never invent one.' },
    date: { type: 'string', description: 'Civil date of the shift start, YYYY-MM-DD. Resolve any spoken date to a full year before calling.' },
    start: { type: 'string', description: 'Start time at the site, HH:mm on a 24 hour clock.' },
    end: { type: 'string', description: 'End time at the site, HH:mm on a 24 hour clock. REQUIRED - if the admin has not said when the shift finishes, ask them. Never assume a duration.' },
    shiftType: { type: 'string', description: 'One of REGULAR, OVERTIME, ON_CALL, NIGHT. Defaults to REGULAR.' },
    breakMinutes: { type: 'string', description: 'Unpaid break in minutes, as digits. Optional.' },
  },
  additionalProperties: false,
};

const resolveSiteRef = async (actor, { siteId, siteName }) => {
  if (siteId) {
    const site = await Site.findOne({ _id: siteId, companyId: actor.companyId })
      .select('_id siteLocationName timezone status')
      .lean();
    if (!site) throw notFound('That site is not in your organisation', { entity: 'site' });
    return { id: site._id.toString(), name: site.siteLocationName, timezone: site.timezone || null, status: site.status };
  }
  if (siteName) return resolveSite(actor, siteName);
  throw invalidInput('Which site should the shift be at?', { missing: ['siteName'] });
};

/** Everything both phases need. Run again at commit, deliberately. */
const build = async (actor, input) => {
  if (!input.date) throw invalidInput('Which date should the shift be on?', { missing: ['date'] });
  if (!input.start) throw invalidInput('What time does the shift start?', { missing: ['start'] });
  if (!input.end) {
    throw invalidInput(
      'What time does the shift finish? There is no default shift length, so an end time is required.',
      { missing: ['end'] }
    );
  }

  const shiftType = (input.shiftType || 'REGULAR').toUpperCase();
  if (!SHIFT_TYPES.includes(shiftType)) {
    throw invalidInput(`Shift type must be one of ${SHIFT_TYPES.join(', ')}`);
  }

  let breakDuration = 0;
  if (input.breakMinutes) {
    if (!/^\d{1,3}$/.test(input.breakMinutes)) throw invalidInput('Break minutes must be a whole number');
    breakDuration = Number(input.breakMinutes);
  }

  const employee = await resolveEmployeeRef(actor, input);
  const site = await resolveSiteRef(actor, input);

  // Re-read live state rather than trusting anything carried from the preview.
  const liveEmployee = await Employee.findOne({ _id: employee.id, companyId: actor.companyId })
    .select('_id isActive')
    .lean();
  if (!liveEmployee?.isActive) {
    throw invalidInput(`${employee.name} is no longer an active employee`);
  }
  if (site.status && site.status !== 'ACTIVE') {
    throw invalidInput(`${site.name} is not an active site`);
  }

  const company = await getCompanyProfile(actor.companyId);
  const timezone = site.timezone || company.timezone;

  const instants = shiftInstants({
    date: input.date,
    start: input.start,
    end: input.end,
    timezone,
  });

  await assertSiteAssignment({
    companyId: actor.companyId,
    employeeId: employee.id,
    siteId: site.id,
    employeeName: employee.name,
    siteName: site.name,
  });

  const conflicts = await findConflicts({
    companyId: actor.companyId,
    employeeId: employee.id,
    startTime: instants.startTime,
    endTime: instants.endTime,
  });

  return { employee, site, timezone, instants, shiftType, breakDuration, conflicts };
};

const prepare = async ({ actor, input }) => {
  const { employee, site, timezone, instants, shiftType, breakDuration, conflicts } = await build(
    actor,
    input
  );

  if (conflicts.length) {
    throw conflict(
      `${employee.name} already has a shift overlapping that time`,
      { conflicts }
    );
  }

  const plan = {
    employeeId: employee.id,
    siteId: site.id,
    startTime: instants.startTime.toISOString(),
    endTime: instants.endTime.toISOString(),
    dateInstant: instants.dateInstant.toISOString(),
    shiftType,
    breakDuration,
    timezone,
  };

  const preview = {
    action: 'Create shift',
    employee: employee.name,
    site: site.name,
    timezone,
    start: instants.localStart,
    end: instants.localEnd,
    hours: instants.hours,
    paidHours: Math.round((instants.hours - breakDuration / 60) * 100) / 100,
    shiftType,
    breakMinutes: breakDuration,
    crossesMidnight: instants.crossesMidnight,
    conflicts: [],
    notes: [
      instants.crossesMidnight
        ? 'This shift finishes the following morning.'
        : null,
      'The employee will be emailed about this shift.',
    ].filter(Boolean),
  };

  return {
    plan,
    preview,
    resolvedEntities: { employee, site },
  };
};

const commit = async ({ actor, draft }) => {
  // The world may have moved while the preview was on screen: another shift
  // created, the employee deactivated, the assignment removed. Everything is
  // checked again from scratch before anything is written.
  const { employee, site, instants, shiftType, breakDuration, conflicts } = await build(
    actor,
    draft.input
  );

  if (conflicts.length) {
    throw conflict(
      `${employee.name} now has a shift overlapping that time, so it was not created`,
      { conflicts }
    );
  }

  // Refuse if the re-derived plan no longer matches what was approved.
  const rebuilt = {
    employeeId: employee.id,
    siteId: site.id,
    startTime: instants.startTime.toISOString(),
    endTime: instants.endTime.toISOString(),
  };
  const approved = draft.plan;
  const drifted = Object.keys(rebuilt).some((k) => rebuilt[k] !== approved[k]);
  if (drifted) {
    throw conflict('The details of this shift changed since it was previewed. Please review it again.');
  }

  const created = await schedulerService.createShift(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    {
      employeeId: employee.id,
      siteId: site.id,
      date: instants.dateInstant,
      startTime: instants.startTime,
      endTime: instants.endTime,
      shiftType,
      breakDuration,
      status: 'SCHEDULED',
    }
  );

  const shiftId = (created?._id || created?.id || '').toString();

  return {
    data: {
      shiftId,
      employee,
      site,
      start: instants.localStart,
      end: instants.localEnd,
      timezone: instants.timezone,
      hours: instants.hours,
      shiftType,
      breakMinutes: breakDuration,
    },
    summary: {
      created: true,
      shiftId,
      employee: employee.name,
      site: site.name,
      start: instants.localStart,
      end: instants.localEnd,
    },
  };
};

module.exports = {
  name: 'createShift',
  description:
    "Roster an employee onto a shift at a site. This CHANGES data, so it is previewed first and only created after the admin explicitly confirms. An end time is required - if the admin has not said when the shift finishes, ask them rather than assuming a length.",
  kind: 'write',
  modules: ['scheduler'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: ['date', 'start', 'end'],
  parameters,
  prepare,
  commit,
};
