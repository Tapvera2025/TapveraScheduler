/**
 * cancelShift — mark a scheduled shift as cancelled.
 *
 * Two-phase. `prepare` finds the shift and shows what will be cancelled.
 * `commit` re-validates and sets status to CANCELLED.
 *
 * Identify by:
 *  - shiftId from a previous findEmployeeShifts result, OR
 *  - employeeName/employeeId + date
 */

const { DateTime } = require('luxon');
const mongoose = require('mongoose');
const Shift = require('../../models/Shift');
const { resolveEmployeeRef } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { inZone } = require('../time');
const { invalidInput, notFound, conflict } = require('../errors');

const parameters = {
  type: 'object',
  properties: {
    shiftId: {
      type: 'string',
      description:
        'Opaque shift id from a previous findEmployeeShifts or getDailySummary result. If provided, employee and date are not needed.',
    },
    employeeName: { type: 'string', description: 'Employee whose shift to cancel.' },
    employeeId: { type: 'string', description: 'Opaque employee id from an earlier tool call.' },
    date: { type: 'string', description: 'Civil date of the shift to cancel, YYYY-MM-DD.' },
  },
  additionalProperties: false,
};

const fetchShiftById = async (actor, shiftId) => {
  if (!mongoose.Types.ObjectId.isValid(shiftId)) {
    throw invalidInput('That shift reference is not valid');
  }
  const shift = await Shift.findOne({ _id: shiftId, companyId: actor.companyId })
    .populate('employeeId', 'firstName lastName')
    .populate('siteId', 'siteLocationName timezone')
    .lean();
  if (!shift) throw notFound('That shift was not found in your organisation');
  return shift;
};

const fetchShiftByEmployeeDate = async (actor, input) => {
  const employee = await resolveEmployeeRef(actor, input);
  if (!input.date || !/^\d{4}-\d{2}-\d{2}$/.test(input.date)) {
    throw invalidInput('Which date is the shift on? Use YYYY-MM-DD.');
  }
  const { timezone } = await getCompanyProfile(actor.companyId);
  const dayStart = DateTime.fromFormat(input.date, 'yyyy-MM-dd', { zone: timezone }).startOf('day');
  const dayEnd = dayStart.plus({ days: 1 });

  const shifts = await Shift.find({
    companyId: actor.companyId,
    employeeId: employee.id,
    status: { $nin: ['CANCELLED'] },
    startTime: { $gte: dayStart.toUTC().toJSDate(), $lt: dayEnd.toUTC().toJSDate() },
  })
    .populate('siteId', 'siteLocationName timezone')
    .lean();

  if (shifts.length === 0) {
    throw notFound(`No active shift found for ${employee.name} on ${input.date}`);
  }
  if (shifts.length > 1) {
    throw conflict(
      `${employee.name} has ${shifts.length} shifts on ${input.date}. Use a shiftId to specify which one.`,
      {
        conflicts: shifts.map((s) => ({
          shiftId: s._id.toString(),
          site: s.siteId?.siteLocationName || null,
          start: inZone(s.startTime, s.siteId?.timezone || timezone),
          end: inZone(s.endTime, s.siteId?.timezone || timezone),
        })),
      }
    );
  }
  return { ...shifts[0], _resolvedEmployee: employee };
};

const resolveShift = (actor, input) =>
  input.shiftId
    ? fetchShiftById(actor, input.shiftId)
    : fetchShiftByEmployeeDate(actor, input);

const employeeName = (shift) =>
  shift._resolvedEmployee?.name ||
  (shift.employeeId ? `${shift.employeeId.firstName} ${shift.employeeId.lastName}` : 'Open shift');

const prepare = async ({ actor, input }) => {
  if (!input.shiftId && !input.employeeName && !input.employeeId) {
    throw invalidInput('Which shift should be cancelled? Give an employee name and date, or a shift id.');
  }

  const shift = await resolveShift(actor, input);

  if (shift.status === 'CANCELLED') {
    throw invalidInput('This shift is already cancelled.');
  }

  const zone = shift.siteId?.timezone || (await getCompanyProfile(actor.companyId)).timezone;
  const name = employeeName(shift);

  return {
    plan: { shiftId: shift._id.toString() },
    preview: {
      action: 'Cancel shift',
      employee: name,
      site: shift.siteId?.siteLocationName || '—',
      start: inZone(shift.startTime, zone),
      end: inZone(shift.endTime, zone),
      status: shift.status,
      notes: ['The shift will be marked cancelled. The employee is not automatically notified.'],
    },
    resolvedEntities: { shift: { id: shift._id.toString() } },
  };
};

const commit = async ({ actor, draft }) => {
  const { shiftId } = draft.plan;
  const shift = await Shift.findOne({ _id: shiftId, companyId: actor.companyId })
    .populate('employeeId', 'firstName lastName')
    .populate('siteId', 'siteLocationName timezone')
    .lean();

  if (!shift) throw notFound('The shift no longer exists');

  const zone = shift.siteId?.timezone || (await getCompanyProfile(actor.companyId)).timezone;
  const name =
    shift.employeeId
      ? `${shift.employeeId.firstName} ${shift.employeeId.lastName}`
      : 'Open shift';

  if (shift.status === 'CANCELLED') {
    return {
      data: { shiftId, employee: name, alreadyCancelled: true, start: inZone(shift.startTime, zone) },
      summary: { cancelled: true, shiftId, alreadyCancelled: true },
    };
  }

  await Shift.updateOne({ _id: shiftId }, { $set: { status: 'CANCELLED' } });

  return {
    data: {
      shiftId,
      employee: name,
      site: shift.siteId?.siteLocationName || null,
      start: inZone(shift.startTime, zone),
      end: inZone(shift.endTime, zone),
    },
    summary: { cancelled: true, shiftId, employee: name },
  };
};

module.exports = {
  name: 'cancelShift',
  description:
    'Cancel a scheduled shift. This CHANGES data and must be confirmed before it runs. Identify the shift by a shiftId from findEmployeeShifts or getDailySummary, or by employee name and date.',
  kind: 'write',
  modules: ['scheduler'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  prepare,
  commit,
};
