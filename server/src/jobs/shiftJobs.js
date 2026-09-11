/**
 * Scheduled shift jobs.
 *
 * Two cron jobs run every 5 minutes:
 *
 *   1. Reminder  — for shifts starting in ~1 hour, email the employee once.
 *      Idempotent via Shift.reminderSentAt.
 *
 *   2. Absence   — for shifts that started ≥15 minutes ago and have no
 *      actualStartTime, transition to NO_SHOW and email the employee. Idempotent
 *      via a compound guard: status must still be SCHEDULED at write time, and
 *      absenceNotifiedAt is set on the same update.
 *
 * Everything is best-effort: a failure inside one loop iteration is logged and
 * does not stop the rest. If the process crashes mid-loop, the idempotency
 * guards mean the next run will simply pick up where this one stopped.
 */

const cron = require('node-cron');
const { DateTime } = require('luxon');
const Shift = require('../models/Shift');
const Company = require('../models/Company');
const emailService = require('../services/email.service');
const logger = require('../utils/logger');

// Window that counts as "starts in about an hour". A 10-minute band centered
// on 60 minutes so we can afford one dropped run without missing anyone.
const REMINDER_LEAD_MIN = 55;
const REMINDER_LEAD_MAX = 65;

// Shift is flagged absent if it has started this many minutes ago and has
// no clock-in. Give a modest grace period so we do not chase people who
// clocked in a minute late.
const ABSENCE_GRACE_MIN = 15;

// Only look this far back — anything older than this is either already
// handled or too stale to bother chasing.
const ABSENCE_LOOKBACK_MIN = 180;

const asDate = (isoOrDate) => (isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate));

const formatLocal = (dt, timezone, fmt) =>
  DateTime.fromJSDate(asDate(dt)).setZone(timezone || 'UTC').toFormat(fmt);

/**
 * Resolve site+employee data for an email. Kept as separate populate calls so
 * the query planner is not confused by nested populate chains.
 */
const enrichShift = async (shift) => {
  const populated = await Shift.findById(shift._id)
    .populate('employeeId', 'firstName lastName email')
    .populate('siteId', 'siteLocationName timezone')
    .lean();
  if (!populated) return null;
  const employee = populated.employeeId;
  const site = populated.siteId;
  if (!employee?.email || !site) return null;

  const timezone = site.timezone || 'Australia/Sydney';
  return {
    to: employee.email,
    employeeName: `${employee.firstName || ''} ${employee.lastName || ''}`.trim(),
    siteName: site.siteLocationName,
    shiftDate: formatLocal(populated.date || populated.startTime, timezone, 'cccc, d LLLL yyyy'),
    startTime: formatLocal(populated.startTime, timezone, 'HH:mm'),
    endTime: formatLocal(populated.endTime, timezone, 'HH:mm'),
    companyId: populated.companyId,
    _raw: populated,
  };
};

// ─── Reminder loop ────────────────────────────────────────────────────────

const runReminderPass = async () => {
  const now = new Date();
  const lower = new Date(now.getTime() + REMINDER_LEAD_MIN * 60 * 1000);
  const upper = new Date(now.getTime() + REMINDER_LEAD_MAX * 60 * 1000);

  const shifts = await Shift.find({
    startTime: { $gte: lower, $lte: upper },
    status: 'SCHEDULED',
    reminderSentAt: null,
    // Adhoc shifts that are still pending admin approval are not confirmed
    // enough to remind on — either PENDING approvals are ignored, or the
    // shift is a regular one (approvalStatus is null).
    approvalStatus: { $in: [null, 'APPROVED'] },
    isDeleted: { $ne: true },
  })
    .select('_id startTime endTime date employeeId siteId companyId')
    .lean();

  if (!shifts.length) return { checked: 0, sent: 0 };

  let sent = 0;
  for (const shift of shifts) {
    try {
      const claimed = await Shift.findOneAndUpdate(
        { _id: shift._id, reminderSentAt: null },
        { $set: { reminderSentAt: new Date() } },
        { new: false }
      ).lean();
      if (!claimed) continue; // another worker got it

      const detail = await enrichShift(shift);
      if (!detail) continue;

      await emailService.sendShiftReminderEmail({
        ...detail,
        minutesUntilStart: Math.round((asDate(shift.startTime) - now) / 60000),
      });
      sent += 1;
    } catch (err) {
      logger.warn('Reminder send failed for shift', { shiftId: String(shift._id), error: err.message });
    }
  }
  return { checked: shifts.length, sent };
};

// ─── Absence loop ─────────────────────────────────────────────────────────

const runAbsencePass = async () => {
  const now = new Date();
  const upper = new Date(now.getTime() - ABSENCE_GRACE_MIN * 60 * 1000);
  const lower = new Date(now.getTime() - ABSENCE_LOOKBACK_MIN * 60 * 1000);

  const shifts = await Shift.find({
    startTime: { $gte: lower, $lte: upper },
    status: 'SCHEDULED',
    actualStartTime: null,
    absenceNotifiedAt: null,
    approvalStatus: { $in: [null, 'APPROVED'] },
    isDeleted: { $ne: true },
  })
    .select('_id startTime endTime date employeeId siteId companyId')
    .lean();

  if (!shifts.length) return { checked: 0, marked: 0 };

  let marked = 0;
  for (const shift of shifts) {
    try {
      // Transition atomically — a shift already flipped away from SCHEDULED
      // by anything else (manual admin edit, clock-in that raced our query)
      // is left alone.
      const claimed = await Shift.findOneAndUpdate(
        { _id: shift._id, status: 'SCHEDULED', actualStartTime: null, absenceNotifiedAt: null },
        { $set: { status: 'NO_SHOW', absenceNotifiedAt: new Date() } },
        { new: false }
      ).lean();
      if (!claimed) continue;

      const detail = await enrichShift(shift);
      if (!detail) continue;

      await emailService.sendShiftAbsenceEmail(detail);
      marked += 1;
    } catch (err) {
      logger.warn('Absence handling failed for shift', { shiftId: String(shift._id), error: err.message });
    }
  }
  return { checked: shifts.length, marked };
};

// ─── Scheduler ────────────────────────────────────────────────────────────

let started = false;

const startShiftJobs = () => {
  if (started) return;
  started = true;

  // Every 5 minutes. The idempotency guards mean a delayed or duplicated run
  // is harmless — at worst we do slightly more DB reads.
  cron.schedule('*/5 * * * *', async () => {
    try {
      const reminder = await runReminderPass();
      if (reminder.sent) logger.info('Shift reminders sent', reminder);
    } catch (err) {
      logger.error('Shift reminder pass failed', { error: err.message });
    }

    try {
      const absence = await runAbsencePass();
      if (absence.marked) logger.info('Shift absences flagged', absence);
    } catch (err) {
      logger.error('Shift absence pass failed', { error: err.message });
    }
  });

  logger.info('Shift jobs scheduled: reminder + absence every 5 minutes');
};

module.exports = { startShiftJobs, runReminderPass, runAbsencePass };
