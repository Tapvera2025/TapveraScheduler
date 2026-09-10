const express = require('express');
const mongoose = require('mongoose');
const router = express.Router();
const { auth } = require('../middleware/auth');
const { requireModule } = require('../middleware/moduleAccess');
const Shift = require('../models/Shift');
const Employee = require('../models/Employee');
const AccessCode = require('../models/AccessCode');
const TimeRecord = require('../models/TimeRecord');
const asyncHandler = require('../utils/asyncHandler');

// All routes require authentication
router.use(auth);

/**
 * Get the employee record linked to the logged-in user
 * @route GET /api/shifts/my-employee
 */
router.get('/my-employee', asyncHandler(async (req, res) => {
  const { userId, companyId } = req.user;

  const employee = await Employee.findOne({
    userId: userId,
    companyId: companyId,
    isActive: true
  }).lean();

  if (!employee) {
    const error = new Error('No employee record found for this user');
    error.statusCode = 404;
    throw error;
  }

  res.json({
    success: true,
    data: { ...employee, id: employee._id.toString() }
  });
}));

/**
 * Get my shifts (for logged-in employees)
 * @route GET /api/shifts/my-shifts
 */
router.get('/my-shifts', requireModule('scheduler'), asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;
  const { userId, companyId } = req.user;

  if (!startDate || !endDate) {
    const error = new Error('startDate and endDate are required');
    error.statusCode = 400;
    throw error;
  }

  // Find the employee record linked to this user
  const employee = await Employee.findOne({
    userId: userId,
    companyId: companyId,
    isActive: true
  });

  if (!employee) {
    const error = new Error('No employee record found for this user');
    error.statusCode = 404;
    throw error;
  }

  // Get shifts for this employee
  const shifts = await Shift.find({
    employeeId: employee._id,
    companyId: companyId,
    date: {
      $gte: new Date(startDate),
      $lte: new Date(endDate)
    }
  })
    .populate('siteId', 'siteLocationName shortName address location')
    .sort({ date: 1, startTime: 1 })
    .lean();

  // Transform shifts
  const transformedShifts = shifts.map(shift => ({
    ...shift,
    id: shift._id.toString(),
    siteId: shift.siteId ? {
      ...shift.siteId,
      id: shift.siteId._id.toString(),
      latitude: shift.siteId.location?.coordinates?.[1] ?? null,
      longitude: shift.siteId.location?.coordinates?.[0] ?? null,
    } : null
  }));

  res.json({
    success: true,
    data: transformedShifts
  });
}));

/**
 * Get access codes for one of MY shifts, filtered by visibility rules.
 *
 * Rules (per code):
 *   visibleOnMobile=false → never returned
 *   whenRostered=true     → returned as soon as the caller is assigned to the shift
 *   afterClockingIn=true  → only returned if the caller has a TimeRecord for this shift
 *
 * The `accessCode` value is stripped for codes that don't pass the rules — we
 * return metadata only for those (name + why-it's-hidden reason) so the client
 * can render a locked state without leaking the credential.
 *
 * @route GET /api/shifts/:id/access-codes
 * @access Private (authenticated employee whose employee record is on the shift)
 */
router.get('/:id/access-codes', asyncHandler(async (req, res) => {
  const { userId, companyId } = req.user;
  const shiftId = req.params.id;

  if (!mongoose.Types.ObjectId.isValid(shiftId)) {
    const error = new Error('Invalid shift ID');
    error.statusCode = 400;
    throw error;
  }

  const employee = await Employee.findOne({
    userId,
    companyId,
    isActive: true,
  }).lean();
  if (!employee) {
    const error = new Error('No employee record found for this user');
    error.statusCode = 404;
    throw error;
  }

  const shift = await Shift.findOne({
    _id: shiftId,
    companyId,
    $or: [
      { employeeId: employee._id },
      { employees: employee._id },
    ],
  }).lean();

  if (!shift) {
    // Either the shift doesn't exist, isn't in this org, or the caller isn't
    // rostered on it. Return 404 in all three cases — don't leak which.
    const error = new Error('Shift not found');
    error.statusCode = 404;
    throw error;
  }

  if (!shift.siteId) {
    // Unusual — a shift without a site can't have access codes.
    return res.json({ success: true, data: [] });
  }

  const codes = await AccessCode.find({
    siteId: shift.siteId,
    companyId,
    isActive: true,
    $or: [
      { expiresAt: null },
      { expiresAt: { $exists: false } },
      { expiresAt: { $gt: new Date() } },
    ],
  }).lean();

  // Determine clock-in state ONCE for the whole list (cheaper than per-code).
  const hasClockedIn = await TimeRecord.exists({
    shiftId,
    employeeId: employee._id,
    companyId,
  });

  const visible = codes
    .filter((c) => c.visibleOnMobile)
    .map((c) => {
      const revealNow =
        c.whenRostered || (c.afterClockingIn && Boolean(hasClockedIn));

      if (revealNow) {
        return {
          id: String(c._id),
          codeName: c.codeName,
          accessCode: c.accessCode,
          notes: c.notes || '',
          locked: false,
        };
      }
      // Placeholder entry so the employee sees the code exists but is locked
      // until they clock in. Never returns the credential itself.
      return {
        id: String(c._id),
        codeName: c.codeName,
        notes: c.notes || '',
        locked: true,
        lockedReason: c.afterClockingIn
          ? 'Available after you clock in on this shift'
          : 'Not currently available',
      };
    });

  res.json({ success: true, data: visible });
}));

module.exports = router;
