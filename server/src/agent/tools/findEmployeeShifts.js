/**
 * findEmployeeShifts — what is this person rostered for?
 *
 * Bounded, tenant-scoped, projection-only. The window is a half-open interval
 * of instants, so an overnight shift belongs to the day it starts and a
 * daylight-saving transition cannot duplicate or drop one.
 */

const Shift = require('../../models/Shift');
const { resolveEmployeeRef } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { resolveDateRangeWindow, inZone, hoursBetween } = require('../time');
const { DateTime } = require('luxon');

const MAX_ROWS = 200;
const DEFAULT_SPAN_DAYS = 14;

const parameters = {
  type: 'object',
  properties: {
    employeeName: {
      type: 'string',
      description: 'The employee as the admin said it, e.g. "Alam Khan". Use this unless you already hold a resolved id from this conversation.',
    },
    employeeId: {
      type: 'string',
      description: 'An opaque employee id returned by an earlier tool call. Never invent one.',
    },
    from: { type: 'string', description: 'First civil date to include, YYYY-MM-DD.' },
    to: { type: 'string', description: 'Last civil date to include, inclusive, YYYY-MM-DD.' },
  },
  additionalProperties: false,
};

const handler = async ({ actor, input }) => {
  const employee = await resolveEmployeeRef(actor, input);
  const { timezone } = await getCompanyProfile(actor.companyId);

  // Default to the fortnight ahead, which is what "what's she on" usually means.
  const today = DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');
  const from = input.from || today;
  const to =
    input.to ||
    DateTime.fromFormat(from, 'yyyy-MM-dd', { zone: timezone })
      .plus({ days: DEFAULT_SPAN_DAYS - 1 })
      .toFormat('yyyy-MM-dd');

  const window = resolveDateRangeWindow({ from, to, timezone });

  const shifts = await Shift.find({
    companyId: actor.companyId,
    employeeId: employee.id,
    startTime: { $gte: window.periodStart, $lt: window.periodEndExclusive },
  })
    .select('_id startTime endTime shiftType status isAdhoc approvalStatus breakDuration siteId')
    .populate('siteId', 'siteLocationName shortName timezone')
    .sort({ startTime: 1 })
    .limit(MAX_ROWS + 1)
    .lean();

  const truncated = shifts.length > MAX_ROWS;
  const rows = (truncated ? shifts.slice(0, MAX_ROWS) : shifts).map((s) => {
    const zone = s.siteId?.timezone || timezone;
    const gross = hoursBetween(s.startTime, s.endTime);
    return {
      id: s._id.toString(),
      site: s.siteId?.siteLocationName || null,
      timezone: zone,
      start: inZone(s.startTime, zone),
      end: inZone(s.endTime, zone),
      startUtc: s.startTime,
      endUtc: s.endTime,
      shiftType: s.shiftType,
      status: s.status,
      isAdhoc: !!s.isAdhoc,
      approvalStatus: s.approvalStatus || null,
      scheduledHours:
        gross === null ? null : Math.round((gross - (s.breakDuration || 0) / 60) * 100) / 100,
    };
  });

  return {
    data: {
      employee,
      window: { from, to, timezone, label: window.label },
      count: rows.length,
      truncated,
      rows,
    },
    resolvedEntities: { employee },
    summary: {
      employee: employee.name,
      window: window.label,
      shifts: rows.length,
      truncated,
    },
  };
};

module.exports = {
  name: 'findEmployeeShifts',
  description:
    "List the shifts an employee is rostered for over a date range. Read-only. Defaults to the next fortnight when no dates are given. Returns each shift in the site's local time.",
  kind: 'read',
  modules: ['scheduler'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 8000,
  maxRows: MAX_ROWS,
  required: [],
  parameters,
  handler,
};
