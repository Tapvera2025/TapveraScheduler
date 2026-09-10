/**
 * getAttendanceReport — the authoritative monthly attendance answer.
 *
 * Deliberately NOT "count the time records". A report is a join of what was
 * rostered, what was actually clocked, and what was approved as leave, over an
 * explicit half-open window in an explicit timezone, evaluated as at an
 * explicit instant.
 *
 * Two rules matter more than the rest:
 *
 *  1. A shift that has not yet come due is never a no-show. Running this report
 *     mid-month must not brand the rest of the month absent.
 *  2. Elapsed clocked time is not payroll hours. Break policy lives on the
 *     shift, not the time record, so paidHours stays null until a policy is
 *     configured rather than quietly reporting elapsed time as payable.
 *
 * Every number here is computed in code. The language model receives the
 * result; it never adds anything up itself.
 */

const { DateTime } = require('luxon');
const Shift = require('../../models/Shift');
const TimeRecord = require('../../models/TimeRecord');
const Leave = require('../../models/Leave');
const { resolveEmployeeRef } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { resolveMonthWindow, inZone, hoursBetween } = require('../time');

const MAX_ROWS = 200;

/**
 * Versioned reporting policy. The version travels with every result so a total
 * can be reproduced later, and so changing a threshold is a visible event.
 */
const POLICY = {
  version: 'attendance-report/1.0.0',
  lateGraceMinutes: 5,
  // A shift only becomes a confirmed no-show once this long past its start.
  noShowGraceMinutes: 30,
  // Cancelled shifts leave the denominator entirely.
  excludeCancelledFromScheduled: true,
  // A shift belongs to the month its start instant falls in.
  allocateBy: 'shiftStart',
  // Clocked time is allocated to the month the clock-in falls in.
  elapsedAllocatedBy: 'clockIn',
};

const CLASSIFICATIONS = [
  'attended',
  'in_progress',
  'missing_clock_out',
  'late',
  'on_leave',
  'not_yet_due',
  'no_show',
  'cancelled',
];

const parameters = {
  type: 'object',
  properties: {
    employeeName: {
      type: 'string',
      description: 'The employee as the admin said it, e.g. "Alam Khan".',
    },
    employeeId: {
      type: 'string',
      description: 'An opaque employee id from an earlier tool call. Never invent one.',
    },
    month: {
      type: 'string',
      description: 'Reporting month as YYYY-MM. Omit for the current month in the organisation timezone.',
    },
  },
  additionalProperties: false,
};

const civilDay = (instant, zone) =>
  DateTime.fromJSDate(new Date(instant)).setZone(zone).toFormat('yyyy-MM-dd');

const handler = async ({ actor, input }) => {
  const employee = await resolveEmployeeRef(actor, input);
  const { timezone } = await getCompanyProfile(actor.companyId);
  const window = resolveMonthWindow({ month: input.month, timezone });
  const asOf = window.asOf;

  const scope = { companyId: actor.companyId, employeeId: employee.id };

  // ---- 1. What was rostered in the window -------------------------------
  const shifts = await Shift.find({
    ...scope,
    startTime: { $gte: window.periodStart, $lt: window.periodEndExclusive },
  })
    .select('_id startTime endTime shiftType status breakDuration siteId isAdhoc')
    .populate('siteId', 'siteLocationName timezone')
    .sort({ startTime: 1 })
    .lean();

  const shiftIds = shifts.map((s) => s._id);

  // ---- 2. What was actually clocked --------------------------------------
  // Widened by half a day either side so a shift starting near a boundary can
  // still be matched to its record. Allocation of HOURS is narrower - see below.
  const HALF_DAY = 12 * 3600 * 1000;
  const records = await TimeRecord.find({
    ...scope,
    $or: [
      { shiftId: { $in: shiftIds } },
      {
        clockInTime: {
          $gte: new Date(window.periodStart.getTime() - HALF_DAY),
          $lt: new Date(window.periodEndExclusive.getTime() + HALF_DAY),
        },
      },
    ],
  })
    .select('_id shiftId clockInTime clockOutTime totalHours status siteId')
    .sort({ clockInTime: 1 })
    .lean();

  // ---- 3. Approved leave overlapping the window --------------------------
  const leave = await Leave.find({
    ...scope,
    status: 'approved',
    startDate: { $lt: window.periodEndExclusive },
    endDate: { $gte: window.periodStart },
  })
    .select('_id leaveType startDate endDate periodDays fullDay')
    .lean();

  const leaveDays = new Set();
  leave.forEach((l) => {
    let cursor = DateTime.fromJSDate(new Date(l.startDate)).setZone(timezone).startOf('day');
    const last = DateTime.fromJSDate(new Date(l.endDate)).setZone(timezone).startOf('day');
    let guard = 0;
    while (cursor <= last && guard < 400) {
      if (cursor.toUTC().toJSDate() >= window.periodStart &&
          cursor.toUTC().toJSDate() < window.periodEndExclusive) {
        leaveDays.add(cursor.toFormat('yyyy-MM-dd'));
      }
      cursor = cursor.plus({ days: 1 });
      guard += 1;
    }
  });

  // ---- 4. Match each shift to at most one record -------------------------
  const usedRecordIds = new Set();
  const byShiftId = new Map();
  records.forEach((r) => {
    if (r.shiftId) byShiftId.set(r.shiftId.toString(), r);
  });

  const matchRecord = (shift) => {
    const direct = byShiftId.get(shift._id.toString());
    if (direct && !usedRecordIds.has(direct._id.toString())) {
      usedRecordIds.add(direct._id.toString());
      return direct;
    }
    // Fall back to a record that actually overlaps the rostered interval.
    const start = new Date(shift.startTime).getTime();
    const end = new Date(shift.endTime).getTime();
    const overlapping = records.find((r) => {
      if (usedRecordIds.has(r._id.toString())) return false;
      if (r.shiftId) return false;
      const inAt = new Date(r.clockInTime).getTime();
      const outAt = r.clockOutTime ? new Date(r.clockOutTime).getTime() : inAt;
      return inAt < end && outAt > start - POLICY.lateGraceMinutes * 60000;
    });
    if (overlapping) {
      usedRecordIds.add(overlapping._id.toString());
      return overlapping;
    }
    return null;
  };

  const exceptions = [];
  const rows = [];
  let scheduledShifts = 0;
  let attendedShifts = 0;
  let confirmedNoShows = 0;
  let lateArrivals = 0;

  shifts.forEach((shift) => {
    const zone = shift.siteId?.timezone || timezone;
    const record = shift.status === 'CANCELLED' ? null : matchRecord(shift);
    const day = civilDay(shift.startTime, zone);

    let classification;
    let late = false;

    if (shift.status === 'CANCELLED') {
      classification = 'cancelled';
    } else if (record) {
      const lateBy =
        new Date(record.clockInTime).getTime() -
        (new Date(shift.startTime).getTime() + POLICY.lateGraceMinutes * 60000);
      late = lateBy > 0;

      if (!record.clockOutTime) {
        classification =
          asOf.getTime() < new Date(shift.endTime).getTime() ? 'in_progress' : 'missing_clock_out';
        if (classification === 'missing_clock_out') {
          exceptions.push({
            shiftId: shift._id.toString(),
            day,
            type: 'missing_clock_out',
            detail: 'Clocked in but never clocked out; hours for this shift are unknown.',
          });
        }
      } else {
        classification = 'attended';
      }
    } else if (leaveDays.has(day)) {
      classification = 'on_leave';
    } else if (
      asOf.getTime() <
      new Date(shift.startTime).getTime() + POLICY.noShowGraceMinutes * 60000
    ) {
      classification = 'not_yet_due';
    } else {
      classification = 'no_show';
    }

    if (!(POLICY.excludeCancelledFromScheduled && classification === 'cancelled')) {
      scheduledShifts += 1;
    }
    if (['attended', 'in_progress', 'missing_clock_out'].includes(classification)) {
      attendedShifts += 1;
    }
    if (classification === 'no_show') confirmedNoShows += 1;
    if (late && classification !== 'cancelled') lateArrivals += 1;

    if (rows.length < MAX_ROWS) {
      rows.push({
        shiftId: shift._id.toString(),
        day,
        site: shift.siteId?.siteLocationName || null,
        timezone: zone,
        scheduledStart: inZone(shift.startTime, zone),
        scheduledEnd: inZone(shift.endTime, zone),
        clockIn: record ? inZone(record.clockInTime, zone) : null,
        clockOut: record?.clockOutTime ? inZone(record.clockOutTime, zone) : null,
        classification,
        late,
        recordedHours: record?.totalHours ?? null,
      });
    }
  });

  // Records inside the window that matched no rostered shift at all.
  records.forEach((r) => {
    const inWindow =
      new Date(r.clockInTime) >= window.periodStart &&
      new Date(r.clockInTime) < window.periodEndExclusive;
    if (inWindow && !usedRecordIds.has(r._id.toString())) {
      exceptions.push({
        recordId: r._id.toString(),
        day: civilDay(r.clockInTime, timezone),
        type: 'unmatched_record',
        detail: 'Clocked time with no matching rostered shift.',
      });
    }
  });

  // ---- 5. Hours, allocated by clock-in ------------------------------------
  const elapsedHours =
    Math.round(
      records
        .filter(
          (r) =>
            new Date(r.clockInTime) >= window.periodStart &&
            new Date(r.clockInTime) < window.periodEndExclusive
        )
        .reduce(
          (sum, r) => sum + (r.totalHours ?? hoursBetween(r.clockInTime, r.clockOutTime) ?? 0),
          0
        ) * 100
    ) / 100;

  return {
    data: {
      employeeId: employee.id,
      employee,
      periodStart: window.periodStart,
      periodEndExclusive: window.periodEndExclusive,
      timezone,
      label: window.label,
      asOf,

      scheduledShifts,
      attendedShifts,
      confirmedNoShows,
      lateArrivals,
      elapsedHours,
      // Deliberately not inferred from elapsed time. See P1-H.
      paidHours: null,
      paidHoursNote:
        'No break/paid-time policy is configured, so payable hours are not derived from elapsed time.',
      approvedLeaveDays: leaveDays.size,

      exceptions,
      rowsTruncated: shifts.length > MAX_ROWS,
      rows,

      classifications: CLASSIFICATIONS,
      sourceVersion: POLICY.version,
      policy: POLICY,
    },
    resolvedEntities: { employee },
    summary: {
      employee: employee.name,
      period: window.label,
      scheduledShifts,
      attendedShifts,
      confirmedNoShows,
      lateArrivals,
      elapsedHours,
      exceptions: exceptions.length,
    },
  };
};

module.exports = {
  name: 'getAttendanceReport',
  description:
    "An employee's attendance for a month: shifts rostered, shifts attended, elapsed clocked hours, late arrivals, confirmed no-shows, approved leave and unresolved exceptions. Read-only. Shifts that have not yet come due are never counted as no-shows. Do not add up or restate these numbers yourself - report them as given.",
  kind: 'read',
  modules: ['attendance'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  maxRows: MAX_ROWS,
  required: [],
  parameters,
  handler,
};
