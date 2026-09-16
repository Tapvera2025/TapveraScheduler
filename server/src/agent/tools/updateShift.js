/**
 * updateShift — reschedule a shift or change its type / break.
 *
 * Identification follows cancelShift: shiftId first, else employeeName/Id + date.
 * Time changes require newDate + start + end together (all three or none).
 * Employee and site reassignment are excluded — those are UI-only operations.
 *
 * prepare computes new instants, checks for conflicts (excludeShiftId so the
 * current shift does not conflict with itself), and stores resolved ISO strings
 * in draft.plan for the drift check in commit.
 */

const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const Shift = require('../../models/Shift');
const schedulerService = require('../../services/scheduler.service');
const { resolveEmployeeRef } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { shiftInstants, findConflicts } = require('../scheduling');
const { inZone } = require('../time');
const { invalidInput, notFound, conflict } = require('../errors');

const SHIFT_TYPES = ['REGULAR', 'OVERTIME', 'ON_CALL', 'NIGHT'];

const parameters = {
  type: 'object',
  properties: {
    shiftId: { type: 'string', description: 'Opaque shift id from a previous findEmployeeShifts or getDailySummary result.' },
    employeeName: { type: 'string', description: 'Employee whose shift to update.' },
    employeeId: { type: 'string', description: 'Opaque employee id from an earlier tool call.' },
    date: { type: 'string', description: 'Civil date of the shift to update, YYYY-MM-DD.' },
    newDate: { type: 'string', description: 'New civil date for the shift, YYYY-MM-DD. Must be supplied together with start and end.' },
    start: { type: 'string', description: 'New start time, HH:mm 24h. Must be supplied together with newDate and end.' },
    end: { type: 'string', description: 'New end time, HH:mm 24h. Must be supplied together with newDate and start.' },
    shiftType: { type: 'string', description: 'New shift type: REGULAR, OVERTIME, ON_CALL, or NIGHT.' },
    breakMinutes: { type: 'string', description: 'New unpaid break in minutes, as digits.' },
  },
  additionalProperties: false,
};

const fetchShiftById = async (actor, shiftId) => {
  if (!mongoose.Types.ObjectId.isValid(shiftId)) throw invalidInput('That shift reference is not valid');
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
    throw invalidInput('Which date is the shift on?', { missing: ['date'] });
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

  if (shifts.length === 0) throw notFound(`No active shift found for ${employee.name} on ${input.date}`);
  if (shifts.length > 1) {
    const zone = timezone;
    throw conflict(
      `${employee.name} has ${shifts.length} shifts on ${input.date}. Use a shiftId to specify which one.`,
      {
        conflicts: shifts.map((s) => ({
          shiftId: s._id.toString(),
          site: s.siteId?.siteLocationName || null,
          start: inZone(s.startTime, s.siteId?.timezone || zone),
          end: inZone(s.endTime, s.siteId?.timezone || zone),
        })),
      }
    );
  }
  return shifts[0];
};

const resolveShift = (actor, input) =>
  input.shiftId ? fetchShiftById(actor, input.shiftId) : fetchShiftByEmployeeDate(actor, input);

const build = async (actor, input) => {
  if (!input.shiftId && !input.employeeName && !input.employeeId) {
    throw invalidInput('Which shift should be updated? Give a shift id, or an employee name and date.');
  }

  const shift = await resolveShift(actor, input);

  if (shift.status === 'CANCELLED') {
    throw invalidInput('This shift is already cancelled and cannot be updated.');
  }

  const hasTime = Boolean(input.newDate || input.start || input.end);
  if (hasTime && !(input.newDate && input.start && input.end)) {
    throw invalidInput('To reschedule a shift, provide a new date, a start time, and an end time together.');
  }

  const updates = {};
  let instants = null;

  if (hasTime) {
    const zone = shift.siteId?.timezone || (await getCompanyProfile(actor.companyId)).timezone;
    instants = shiftInstants({ date: input.newDate, start: input.start, end: input.end, timezone: zone });
    updates.date = instants.dateInstant;
    updates.startTime = instants.startTime;
    updates.endTime = instants.endTime;
  }

  if (input.shiftType) {
    const st = input.shiftType.toUpperCase();
    if (!SHIFT_TYPES.includes(st)) throw invalidInput(`Shift type must be one of ${SHIFT_TYPES.join(', ')}`);
    updates.shiftType = st;
  }

  if (input.breakMinutes !== undefined && input.breakMinutes !== null) {
    if (!/^\d{1,3}$/.test(String(input.breakMinutes))) throw invalidInput('Break minutes must be a whole number');
    updates.breakDuration = Number(input.breakMinutes);
  }

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide a new date/time, shift type, or break duration.');
  }

  if (instants) {
    const employeeId = shift.employeeId?._id?.toString() || shift.employeeId?.toString();
    const conflicts = await findConflicts({
      companyId: actor.companyId,
      employeeId,
      startTime: instants.startTime,
      endTime: instants.endTime,
      excludeShiftId: shift._id.toString(),
    });
    if (conflicts.length) {
      throw conflict('The employee already has a shift overlapping the new time', { conflicts });
    }
  }

  return { shift, updates, instants };
};

const prepare = async ({ actor, input }) => {
  const { shift, updates, instants } = await build(actor, input);
  const zone = shift.siteId?.timezone || (await getCompanyProfile(actor.companyId)).timezone;
  const shiftId = shift._id.toString();
  const employeeName =
    shift.employeeId
      ? `${shift.employeeId.firstName} ${shift.employeeId.lastName}`
      : 'Open shift';

  const plan = {
    shiftId,
    ...(instants
      ? {
          startTime: instants.startTime.toISOString(),
          endTime: instants.endTime.toISOString(),
          dateInstant: instants.dateInstant.toISOString(),
        }
      : {}),
    ...(updates.shiftType ? { shiftType: updates.shiftType } : {}),
    ...(updates.breakDuration !== undefined ? { breakDuration: updates.breakDuration } : {}),
  };

  return {
    plan,
    preview: {
      action: 'Update shift',
      employee: employeeName,
      site: shift.siteId?.siteLocationName || '—',
      currentStart: inZone(shift.startTime, zone),
      currentEnd: inZone(shift.endTime, zone),
      changes: [
        ...(instants ? [`reschedule to ${instants.localStart} – ${instants.localEnd}`] : []),
        ...(updates.shiftType ? [`shiftType: ${updates.shiftType}`] : []),
        ...(updates.breakDuration !== undefined ? [`break: ${updates.breakDuration} min`] : []),
      ],
    },
    resolvedEntities: { shift: { id: shiftId } },
  };
};

const commit = async ({ actor, draft }) => {
  const { shift, updates, instants } = await build(actor, draft.input);
  const shiftId = shift._id.toString();

  if (instants) {
    if (
      instants.startTime.toISOString() !== draft.plan.startTime ||
      instants.endTime.toISOString() !== draft.plan.endTime
    ) {
      throw conflict('The shift times changed since it was previewed. Please review it again.');
    }
  }

  try {
    await schedulerService.updateShift(
      { companyId: actor.companyId, userId: actor.userId, role: actor.role },
      shiftId,
      updates
    );
  } catch (err) {
    if (err.statusCode === 404) throw notFound('That shift no longer exists', { entity: 'shift' });
    if (err.statusCode === 409) throw conflict(err.message);
    throw err;
  }

  return {
    data: { shiftId, changes: Object.keys(draft.plan).filter((k) => k !== 'shiftId') },
    summary: { updated: true, shiftId },
  };
};

module.exports = {
  name: 'updateShift',
  description:
    'Update a shift — reschedule it to a new date and time, change its type, or adjust the break. This CHANGES data and must be confirmed. Identify the shift by id, or by employee name and date.',
  kind: 'write',
  modules: ['scheduler'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: [],
  parameters,
  prepare,
  commit,
};
