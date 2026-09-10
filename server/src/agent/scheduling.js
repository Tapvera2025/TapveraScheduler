/**
 * Scheduling invariants the agent enforces before it writes anything.
 *
 * The canonical overlap rule is the whole point of this file:
 *
 *     existing.startTime < proposed.endTime && existing.endTime > proposed.startTime
 *
 * Half-open, and with NO same-date predicate. The existing scheduler service
 * additionally constrains conflicts to `date: new Date(data.date)`, which means
 * a night shift running 22:00-06:00 (stored with yesterday's date) is invisible
 * when checking a 00:00-08:00 shift on the following day. Two overlapping
 * shifts on one person is a real rostering failure, so the agent does not rely
 * on that check.
 */

const { DateTime } = require('luxon');
const Shift = require('../models/Shift');
const EmployeeSite = require('../models/EmployeeSite');
const { invalidInput, forbidden } = require('./errors');

const MAX_SHIFT_HOURS = 24;
const CONFLICT_SAMPLE = 5;

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Turn a civil date and two civil clock times, as spoken about a specific site,
 * into UTC instants. An end at or before the start is read as the next morning,
 * which is reported explicitly rather than applied silently.
 */
const shiftInstants = ({ date, start, end, timezone }) => {
  if (!DATE_PATTERN.test(date || '')) {
    throw invalidInput(`Shift date must look like YYYY-MM-DD, received "${date}"`);
  }
  if (!TIME_PATTERN.test(start || '')) {
    throw invalidInput(`Start time must look like HH:mm on a 24 hour clock, received "${start}"`);
  }
  if (!TIME_PATTERN.test(end || '')) {
    throw invalidInput(`End time must look like HH:mm on a 24 hour clock, received "${end}"`);
  }

  const startLocal = DateTime.fromFormat(`${date} ${start}`, 'yyyy-MM-dd HH:mm', { zone: timezone });
  if (!startLocal.isValid) {
    throw invalidInput(`Could not read ${date} ${start} in ${timezone}`);
  }

  let endLocal = DateTime.fromFormat(`${date} ${end}`, 'yyyy-MM-dd HH:mm', { zone: timezone });
  if (!endLocal.isValid) {
    throw invalidInput(`Could not read ${date} ${end} in ${timezone}`);
  }

  const crossesMidnight = endLocal <= startLocal;
  if (crossesMidnight) endLocal = endLocal.plus({ days: 1 });

  const hours = endLocal.diff(startLocal, 'hours').hours;
  if (hours <= 0) {
    throw invalidInput('A shift must end after it starts');
  }
  if (hours > MAX_SHIFT_HOURS) {
    throw invalidInput(`A single shift cannot run longer than ${MAX_SHIFT_HOURS} hours`);
  }

  return {
    startTime: startLocal.toUTC().toJSDate(),
    endTime: endLocal.toUTC().toJSDate(),
    // Shift.date is required by the model; anchor it to local midnight of the
    // day the shift starts so it agrees with the start instant.
    dateInstant: startLocal.startOf('day').toUTC().toJSDate(),
    crossesMidnight,
    hours: Math.round(hours * 100) / 100,
    localStart: startLocal.toFormat('d LLL yyyy, HH:mm'),
    localEnd: endLocal.toFormat('d LLL yyyy, HH:mm'),
    timezone,
  };
};

/**
 * Every non-cancelled shift for this employee that overlaps the proposed
 * interval, regardless of which calendar day each one is filed under.
 */
const findConflicts = async ({ companyId, employeeId, startTime, endTime, excludeShiftId }) => {
  const query = {
    companyId,
    employeeId,
    status: { $nin: ['CANCELLED'] },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
  };

  if (excludeShiftId) query._id = { $ne: excludeShiftId };

  const conflicts = await Shift.find(query)
    .select('_id startTime endTime status shiftType siteId')
    .populate('siteId', 'siteLocationName timezone')
    .sort({ startTime: 1 })
    .limit(CONFLICT_SAMPLE)
    .lean();

  return conflicts.map((c) => {
    const zone = c.siteId?.timezone || 'UTC';
    return {
      shiftId: c._id.toString(),
      site: c.siteId?.siteLocationName || null,
      status: c.status,
      shiftType: c.shiftType,
      start: DateTime.fromJSDate(new Date(c.startTime)).setZone(zone).toFormat('d LLL yyyy, HH:mm'),
      end: DateTime.fromJSDate(new Date(c.endTime)).setZone(zone).toFormat('d LLL yyyy, HH:mm'),
      timezone: zone,
    };
  });
};

/**
 * An employee may only be rostered at a site they are assigned to. The existing
 * service checks this too; it is repeated here so the preview can explain the
 * problem before anyone confirms, rather than failing at the last moment.
 */
const assertSiteAssignment = async ({ companyId, employeeId, siteId, employeeName, siteName }) => {
  const assignment = await EmployeeSite.findOne({
    companyId,
    employeeId,
    siteId,
    isActive: true,
  })
    .select('_id')
    .lean();

  if (!assignment) {
    throw forbidden(`${employeeName} is not assigned to ${siteName}`, {
      reason: 'SITE_NOT_ASSIGNED',
    });
  }
};

module.exports = { shiftInstants, findConflicts, assertSiteAssignment, MAX_SHIFT_HOURS };
