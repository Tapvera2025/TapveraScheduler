const express = require('express');
const router = express.Router();
const { auth } = require('../middleware/auth');
const asyncHandler = require('../utils/asyncHandler');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const TimeRecord = require('../models/TimeRecord');
const Site = require('../models/Site');
const Leave = require('../models/Leave');

// All routes require authentication
router.use(auth);

// Adhoc requests awaiting a decision are not rostered work, so they are left out
// of the shift counts. null also covers regular shifts and rows created before
// adhoc approval existed.
const ROSTERED = { approvalStatus: { $in: [null, 'APPROVED'] } };

/**
 * GET /api/dashboard/stats
 * Returns summary counts for the admin dashboard stats bar.
 * All counts are scoped to today (local server date) unless noted.
 */
router.get('/stats', asyncHandler(async (req, res) => {
  const { companyId } = req.user;

  // Build today's UTC range
  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  const [
    tentativeShifts,
    openShifts,
    unpublishedShifts,
    noShowShifts,
    activeEmployees,
    activeSites,
    clockedInNow,
    todayShifts,
    todayTimeRecords,
    pendingLeaveRequests,
    pendingAdhocRequests,
  ] = await Promise.all([
    // Tentative = IN_PROGRESS shifts today
    Shift.countDocuments({
      companyId,
      status: 'IN_PROGRESS',
      date: { $gte: startOfToday, $lte: endOfToday },
      ...ROSTERED,
    }),
    // Open shifts = shifts with no employee assigned today
    Shift.countDocuments({
      companyId,
      employeeId: null,
      date: { $gte: startOfToday, $lte: endOfToday },
      ...ROSTERED,
    }),
    // Unpublished = SCHEDULED shifts today (not yet started)
    Shift.countDocuments({
      companyId,
      status: 'SCHEDULED',
      date: { $gte: startOfToday, $lte: endOfToday },
      ...ROSTERED,
    }),
    // No Show = CANCELLED or NO_SHOW shifts today
    Shift.countDocuments({
      companyId,
      status: { $in: ['CANCELLED', 'NO_SHOW'] },
      date: { $gte: startOfToday, $lte: endOfToday },
      ...ROSTERED,
    }),
    // Active employees total
    Employee.countDocuments({ companyId, isActive: true }),
    // Active sites total
    Site.countDocuments({ companyId, status: 'ACTIVE' }),
    // Currently clocked in (any day)
    TimeRecord.countDocuments({ companyId, status: 'CLOCKED_IN' }),
    // All scheduled shifts today
    Shift.countDocuments({
      companyId,
      date: { $gte: startOfToday, $lte: endOfToday },
      ...ROSTERED,
    }),
    // Time records today
    TimeRecord.countDocuments({
      companyId,
      clockInTime: { $gte: startOfToday, $lte: endOfToday },
    }),
    // Pending leave requests (all time — awaiting action)
    Leave.countDocuments({ companyId, status: 'pending' }),
    // Adhoc shift requests awaiting a decision
    Shift.countDocuments({ companyId, isAdhoc: true, approvalStatus: 'PENDING' }),
  ]);

  res.json({
    success: true,
    data: {
      tentativeShifts,
      openShifts,
      unpublishedShifts,
      noShowAbsent: noShowShifts,
      leaveRequests: pendingLeaveRequests,
      pendingAdhocRequests,
      activeEmployees,
      activeSites,
      clockedInNow,
      todayShifts,
      todayTimeRecords,
    },
  });
}));

/**
 * GET /api/dashboard/attendance
 * Returns today's clock-in records PLUS assigned shifts with no clock-in (no-shows).
 */
router.get('/attendance', asyncHandler(async (req, res) => {
  const { companyId } = req.user;

  const now = new Date();
  const startOfToday = new Date(now);
  startOfToday.setHours(0, 0, 0, 0);
  const endOfToday = new Date(now);
  endOfToday.setHours(23, 59, 59, 999);

  // 1. All clock-in records for today
  const records = await TimeRecord.find({
    companyId,
    clockInTime: { $gte: startOfToday, $lte: endOfToday },
  })
    .populate('employeeId', 'firstName lastName phone')
    .populate('siteId', 'siteLocationName shortName')
    .populate('shiftId', 'startTime endTime')
    .sort({ clockInTime: -1 })
    .lean();

  // 2. All assigned, non-cancelled shifts today
  const todayShifts = await Shift.find({
    companyId,
    employeeId: { $ne: null },
    date: { $gte: startOfToday, $lte: endOfToday },
    status: { $nin: ['CANCELLED'] },
    ...ROSTERED,
  })
    .populate('employeeId', 'firstName lastName phone')
    .populate('siteId', 'siteLocationName shortName')
    .lean();

  // Build a set of employeeIds that have clocked in today
  const clockedInEmployees = new Set(
    records.map((r) => r.employeeId?._id?.toString()).filter(Boolean)
  );

  // No-show = assigned shift with no clock-in record today for that employee
  const noShowShifts = todayShifts.filter(
    (s) => !clockedInEmployees.has(s.employeeId?._id?.toString())
  );

  // Format clocked records
  const LATE_GRACE_MS = 5 * 60 * 1000;
  const EARLY_GRACE_MS = 5 * 60 * 1000;

  const clockedRows = records.map((r) => {
    const shiftStart = r.shiftId ? new Date(r.shiftId.startTime) : null;
    const shiftEnd   = r.shiftId ? new Date(r.shiftId.endTime)   : null;

    const shiftHrs = shiftStart && shiftEnd
      ? ((shiftEnd - shiftStart) / 3600000).toFixed(2)
      : null;

    // Compute break minutes from breaks array (completed breaks only for totalHrs; all for display)
    const completedBreakMs = (r.breaks || []).reduce((acc, b) => {
      if (!b.endTime) return acc;
      return acc + (new Date(b.endTime) - new Date(b.startTime));
    }, 0);
    const breakMins = Math.round(completedBreakMs / 60000);

    // onBreak = last break entry has no endTime
    const lastBreak = (r.breaks || []).slice(-1)[0];
    const onBreak = !!(lastBreak && !lastBreak.endTime);

    // For still-clocked-in rows, compute elapsed net of breaks
    let totalHrs = r.totalHours != null ? r.totalHours.toFixed(2) : null;
    if (r.status === 'CLOCKED_IN') {
      const grossMs = now - new Date(r.clockInTime);
      const elapsedMs = Math.max(0, grossMs - completedBreakMs);
      totalHrs = (elapsedMs / 3600000).toFixed(2);
    }

    // Late arrival: clocked in after shift start + grace
    const isLate = shiftStart && (new Date(r.clockInTime) - shiftStart) > LATE_GRACE_MS;

    // Early leave: clocked out before shift end - grace
    const isEarlyLeave = shiftEnd && r.clockOutTime &&
      (shiftEnd - new Date(r.clockOutTime)) > EARLY_GRACE_MS;

    return {
      id: r._id.toString(),
      date: r.clockInTime,
      employee: r.employeeId ? `${r.employeeId.firstName} ${r.employeeId.lastName}` : 'Unknown',
      mobile: r.employeeId?.phone || '—',
      site: r.siteId?.shortName || r.siteId?.siteLocationName || '—',
      shiftTime: shiftStart && shiftEnd
        ? `${shiftStart.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${shiftEnd.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`
        : '—',
      shiftHrs,
      clockIn: r.clockInTime,
      clockOut: r.clockOutTime || null,
      breakMins,
      onBreak,
      totalHrs,
      clockInTimestamp: r.clockInTime,   // raw ISO for client-side live ticker
      isLate: !!isLate,
      isEarlyLeave: !!isEarlyLeave,
      status: r.status,
    };
  });

  // Format no-show rows
  const noShowRows = noShowShifts.map((s) => {
    const shiftHrs = s.startTime && s.endTime
      ? ((new Date(s.endTime) - new Date(s.startTime)) / 3600000).toFixed(2)
      : null;

    return {
      id: s._id.toString(),
      date: s.date,
      employee: s.employeeId ? `${s.employeeId.firstName} ${s.employeeId.lastName}` : 'Unknown',
      mobile: s.employeeId?.phone || '—',
      site: s.siteId?.shortName || s.siteId?.siteLocationName || '—',
      shiftTime: s.startTime && s.endTime
        ? `${new Date(s.startTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })} - ${new Date(s.endTime).toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false })}`
        : '—',
      shiftHrs,
      clockIn: null,
      clockOut: null,
      breakMins: 0,
      totalHrs: null,
      status: 'NO_SHOW',
    };
  });

  res.json({ success: true, data: [...clockedRows, ...noShowRows] });
}));

/**
 * GET /api/dashboard/coverage
 * Rostered hours and shifts against what was actually clocked.
 *
 * @query period - today | week | month (default: week)
 */
router.get('/coverage', asyncHandler(async (req, res) => {
  const { companyId } = req.user;
  const period = ['today', 'week', 'month'].includes(req.query.period)
    ? req.query.period
    : 'week';

  const start = new Date();
  const end = new Date();

  if (period === 'today') {
    start.setHours(0, 0, 0, 0);
    end.setHours(23, 59, 59, 999);
  } else if (period === 'week') {
    // Week starts Monday
    const dayOfWeek = (start.getDay() + 6) % 7;
    start.setDate(start.getDate() - dayOfWeek);
    start.setHours(0, 0, 0, 0);
    end.setTime(start.getTime());
    end.setDate(end.getDate() + 6);
    end.setHours(23, 59, 59, 999);
  } else {
    start.setDate(1);
    start.setHours(0, 0, 0, 0);
    end.setMonth(end.getMonth() + 1, 0);
    end.setHours(23, 59, 59, 999);
  }

  // Aggregations bypass the soft-delete query middleware, so deletedAt is
  // matched explicitly here.
  const [rosteredRows, actualRows] = await Promise.all([
    Shift.aggregate([
      {
        $match: {
          companyId: String(companyId),
          deletedAt: null,
          date: { $gte: start, $lte: end },
          status: { $nin: ['CANCELLED'] },
          approvalStatus: { $in: [null, 'APPROVED'] },
        },
      },
      {
        $group: {
          _id: null,
          shifts: { $sum: 1 },
          hours: {
            $sum: { $divide: [{ $subtract: ['$endTime', '$startTime'] }, 3600000] },
          },
        },
      },
    ]),
    TimeRecord.aggregate([
      {
        $match: {
          companyId: String(companyId),
          deletedAt: null,
          clockInTime: { $gte: start, $lte: end },
        },
      },
      {
        $group: {
          _id: null,
          records: { $sum: 1 },
          hours: { $sum: { $ifNull: ['$totalHours', 0] } },
          stillClockedIn: {
            $sum: { $cond: [{ $eq: ['$status', 'CLOCKED_IN'] }, 1, 0] },
          },
        },
      },
    ]),
  ]);

  // Add elapsed hours from currently-clocked-in employees (not yet clocked out)
  const stillIn = await TimeRecord.find({
    companyId: String(companyId),
    status: 'CLOCKED_IN',
    clockInTime: { $gte: start, $lte: end },
  }).select('clockInTime breaks').lean();

  const inProgressHours = stillIn.reduce((acc, r) => {
    const completedBreakMs = (r.breaks || []).reduce((bAcc, b) => {
      if (!b.endTime) return bAcc;
      return bAcc + (new Date(b.endTime) - new Date(b.startTime));
    }, 0);
    const elapsedMs = Math.max(0, new Date() - new Date(r.clockInTime) - completedBreakMs);
    return acc + elapsedMs / 3600000;
  }, 0);

  const round = (value) => Math.round((value || 0) * 100) / 100;

  const rosteredHours = round(rosteredRows[0]?.hours);
  const rosteredShifts = rosteredRows[0]?.shifts || 0;
  const actualHours = round((actualRows[0]?.hours || 0) + inProgressHours);
  const actualRecords = actualRows[0]?.records || 0;
  const stillClockedIn = actualRows[0]?.stillClockedIn || 0;

  const pct = (part, whole) => (whole > 0 ? Math.round((part / whole) * 100) : 0);

  res.json({
    success: true,
    data: {
      period,
      start,
      end,
      rostered: { hours: rosteredHours, shifts: rosteredShifts },
      actual: { hours: actualHours, records: actualRecords, stillClockedIn },
      difference: {
        hours: round(actualHours - rosteredHours),
        shifts: actualRecords - rosteredShifts,
      },
      // How much of the rostered time was actually worked (includes in-progress elapsed time)
      hoursPercentage: pct(actualHours, rosteredHours),
      // How many rostered shifts were attended at all
      shiftsPercentage: pct(actualRecords, rosteredShifts),
    },
  });
}));

module.exports = router;
