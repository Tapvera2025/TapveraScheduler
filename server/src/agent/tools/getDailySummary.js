/**
 * getDailySummary — who is rostered on a given date?
 *
 * Returns all non-cancelled shifts for the requested civil date, with employee
 * names, sites and times. Defaults to today in the organisation timezone.
 * Optionally filtered to one site.
 */

const { DateTime } = require('luxon');
const mongoose = require('mongoose');
const Shift = require('../../models/Shift');
const Site = require('../../models/Site');
const { getCompanyProfile } = require('../tenant');
const { resolveSite } = require('../resolver');
const { inZone } = require('../time');
const { invalidInput } = require('../errors');

const MAX_ROWS = 200;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

const parameters = {
  type: 'object',
  properties: {
    date: {
      type: 'string',
      description: 'Civil date YYYY-MM-DD. Omit for today in the organisation timezone.',
    },
    siteName: {
      type: 'string',
      description: 'Optional. Restrict to one site.',
    },
    siteId: {
      type: 'string',
      description: 'Optional opaque site id from an earlier tool call.',
    },
  },
  additionalProperties: false,
};

const handler = async ({ actor, input }) => {
  const { companyId } = actor;
  const { timezone } = await getCompanyProfile(companyId);

  const today = DateTime.now().setZone(timezone).toFormat('yyyy-MM-dd');
  const dateStr = input.date || today;

  if (!DATE_PATTERN.test(dateStr)) {
    throw invalidInput(`Date must be YYYY-MM-DD, received "${dateStr}"`);
  }

  const dayStart = DateTime.fromFormat(dateStr, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });

  const query = {
    companyId,
    status: { $nin: ['CANCELLED'] },
    startTime: { $gte: dayStart.toUTC().toJSDate(), $lt: dayEnd.toUTC().toJSDate() },
  };

  let resolvedSite = null;
  if (input.siteId || input.siteName) {
    if (input.siteId) {
      if (!mongoose.Types.ObjectId.isValid(input.siteId)) {
        throw invalidInput('That site reference is not valid');
      }
      const s = await Site.findOne({ _id: input.siteId, companyId })
        .select('_id siteLocationName')
        .lean();
      resolvedSite = s ? { id: s._id.toString(), name: s.siteLocationName } : null;
    } else {
      resolvedSite = await resolveSite(actor, input.siteName);
    }
    if (resolvedSite) query.siteId = resolvedSite.id;
  }

  const shifts = await Shift.find(query)
    .select('_id startTime endTime shiftType status isAdhoc breakDuration siteId employeeId')
    .populate('employeeId', 'firstName lastName position')
    .populate('siteId', 'siteLocationName shortName timezone')
    .sort({ startTime: 1 })
    .limit(MAX_ROWS + 1)
    .lean();

  const truncated = shifts.length > MAX_ROWS;
  const rows = (truncated ? shifts.slice(0, MAX_ROWS) : shifts).map((s) => {
    const zone = s.siteId?.timezone || timezone;
    const grossMs = s.endTime && s.startTime ? new Date(s.endTime) - new Date(s.startTime) : 0;
    const grossH = grossMs > 0 ? grossMs / 3600000 : 0;
    const paidH = Math.round((grossH - (s.breakDuration || 0) / 60) * 100) / 100;
    return {
      shiftId: s._id.toString(),
      employee: s.employeeId
        ? {
            id: s.employeeId._id.toString(),
            name: `${s.employeeId.firstName} ${s.employeeId.lastName}`,
            position: s.employeeId.position || null,
          }
        : null,
      site: s.siteId?.siteLocationName || null,
      shortName: s.siteId?.shortName || null,
      start: inZone(s.startTime, zone),
      end: inZone(s.endTime, zone),
      scheduledHours: paidH,
      shiftType: s.shiftType,
      status: s.status,
      isAdhoc: !!s.isAdhoc,
    };
  });

  const openCount = rows.filter((r) => !r.employee).length;

  return {
    data: {
      date: dateStr,
      isToday: dateStr === today,
      site: resolvedSite?.name || null,
      totalShifts: rows.length,
      openShifts: openCount,
      truncated,
      rows,
    },
    resolvedEntities: resolvedSite ? { site: resolvedSite } : {},
    summary: {
      date: dateStr,
      totalShifts: rows.length,
      openShifts: openCount,
      site: resolvedSite?.name || 'all sites',
    },
  };
};

module.exports = {
  name: 'getDailySummary',
  description:
    "Show who is rostered on a given date, across all sites or filtered to one. Read-only. Defaults to today. Returns each shift's employee, site, start and end time.",
  kind: 'read',
  modules: ['scheduler'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  handler,
};
