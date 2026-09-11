const Leave = require('../models/Leave');
const Employee = require('../models/Employee');
const User = require('../models/User');
const emailService = require('./email.service');
const logger = require('../utils/logger');

class LeaveService {
  /**
   * Calculate working days between two dates (inclusive, Mon-Fri)
   */
  _calcDays(start, end) {
    let count = 0;
    const cur = new Date(start);
    while (cur <= end) {
      const day = cur.getDay();
      if (day !== 0 && day !== 6) count++;
      cur.setDate(cur.getDate() + 1);
    }
    return count || 1;
  }

  /**
   * Get all leave requests for the company (admin view)
   */
  async getAllLeaves(companyId, filters = {}) {
    const { status, employeeId, leaveType, startDate, endDate, page = 1, limit = 25 } = filters;

    const query = { companyId };
    if (status && status !== 'all') query.status = status;
    if (employeeId) query.employeeId = employeeId;
    if (leaveType && leaveType !== 'all') query.leaveType = leaveType;

    // Return leave that overlaps the requested window, rather than only leave
    // that starts inside it. This includes a request spanning the boundary.
    const rangeStart = startDate ? new Date(startDate) : null;
    const rangeEnd = endDate ? new Date(endDate) : null;
    if (rangeStart && !Number.isNaN(rangeStart.getTime())) query.endDate = { $gte: rangeStart };
    if (rangeEnd && !Number.isNaN(rangeEnd.getTime())) query.startDate = { $lte: rangeEnd };

    const skip = (page - 1) * limit;

    const [leaves, total] = await Promise.all([
      Leave.find(query)
        .populate('employeeId', 'firstName lastName email')
        .populate('actionedBy', 'name email')
        .populate('submittedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Leave.countDocuments(query),
    ]);

    return {
      leaves,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get leave stats for the company
   */
  async getLeaveStats(companyId) {
    const stats = await Leave.aggregate([
      { $match: { companyId: require('mongoose').Types.ObjectId.createFromHexString(companyId.toString()) } },
      { $group: { _id: '$status', count: { $sum: 1 } } },
    ]);

    const result = { total: 0, pending: 0, approved: 0, declined: 0, cancelled: 0 };
    stats.forEach(({ _id, count }) => {
      result[_id] = count;
      result.total += count;
    });
    return result;
  }

  /**
   * Get leave requests for a specific employee (employee view)
   */
  async getMyLeaves(employeeId, companyId, filters = {}) {
    const { status, page = 1, limit = 25 } = filters;

    const query = { employeeId, companyId };
    if (status && status !== 'all') query.status = status;

    const skip = (page - 1) * limit;

    const [leaves, total] = await Promise.all([
      Leave.find(query)
        .populate('actionedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Leave.countDocuments(query),
    ]);

    return {
      leaves,
      pagination: { total, page: parseInt(page), limit: parseInt(limit), pages: Math.ceil(total / limit) },
    };
  }

  /**
   * Create a leave request (admin or employee)
   */
  async createLeave(companyId, submittedByUserId, data) {
    const { employeeId, leaveType, startDate, endDate, fullDay = true, notes = '' } = data;

    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end < start) throw new Error('End date must be on or after start date');

    const periodDays = this._calcDays(start, end);

    const leave = await Leave.create({
      companyId,
      employeeId,
      leaveType,
      startDate: start,
      endDate: end,
      fullDay,
      periodDays,
      notes,
      status: 'pending',
      submittedBy: submittedByUserId,
    });

    // Send notification email to admin(s) if an employee submitted it
    // (fire-and-forget, don't block)
    this._notifyAdminNewRequest(leave, companyId).catch((e) =>
      logger.warn('Admin leave notification email failed:', e.message)
    );

    return leave;
  }

  /**
   * Approve a leave request
   */
  async approveLeave(leaveId, companyId, actionedByUserId, actionNote = '') {
    const leave = await Leave.findOne({ _id: leaveId, companyId });
    if (!leave) throw new Error('Leave request not found');
    if (leave.status !== 'pending') throw new Error('Only pending requests can be approved');

    leave.status = 'approved';
    leave.actionedBy = actionedByUserId;
    leave.actionedAt = new Date();
    leave.actionNote = actionNote;
    await leave.save();

    await this._notifyEmployee(leave, 'approved', actionNote);
    return leave;
  }

  /**
   * Decline a leave request
   */
  async declineLeave(leaveId, companyId, actionedByUserId, actionNote = '') {
    const leave = await Leave.findOne({ _id: leaveId, companyId });
    if (!leave) throw new Error('Leave request not found');
    if (leave.status !== 'pending') throw new Error('Only pending requests can be declined');

    leave.status = 'declined';
    leave.actionedBy = actionedByUserId;
    leave.actionedAt = new Date();
    leave.actionNote = actionNote;
    await leave.save();

    await this._notifyEmployee(leave, 'declined', actionNote);
    return leave;
  }

  /**
   * Cancel a leave request (can be done by the employee themselves or admin)
   */
  async cancelLeave(leaveId, companyId, userId) {
    const leave = await Leave.findOne({ _id: leaveId, companyId });
    if (!leave) throw new Error('Leave request not found');
    if (!['pending', 'approved'].includes(leave.status))
      throw new Error('Only pending or approved requests can be cancelled');

    leave.status = 'cancelled';
    leave.actionedBy = userId;
    leave.actionedAt = new Date();
    await leave.save();
    return leave;
  }

  // ─── Email helpers ───────────────────────────────────────────────────────────
  //
  // Both helpers delegate to `email.service.js` which owns the shared design
  // system (see renderEmail). Do not inline HTML here — every message should
  // look like it came from the same product.

  async _notifyEmployee(leave, newStatus, actionNote) {
    try {
      const employee = await Employee.findById(leave.employeeId).lean();
      if (!employee?.email) return;

      const fmt = (d) =>
        new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

      await emailService.sendLeaveDecisionEmail({
        to: employee.email,
        employeeName: `${employee.firstName} ${employee.lastName}`.trim(),
        decision: newStatus === 'approved' ? 'approved' : 'declined',
        leaveType: leave.leaveType,
        startDate: fmt(leave.startDate),
        endDate: fmt(leave.endDate),
        days: leave.periodDays,
        actionNote,
        companyId: leave.companyId,
      });
    } catch (err) {
      logger.warn('Failed to send leave status email to employee:', err.message);
    }
  }

  async _notifyAdminNewRequest(leave, companyId) {
    try {
      const admins = await User.find({
        companyId,
        role: { $in: ['ADMIN', 'MANAGER'] },
        isActive: true,
      })
        .select('email name')
        .lean();
      if (!admins.length) return;

      const employee = await Employee.findById(leave.employeeId).lean();
      if (!employee) return;

      const fmt = (d) =>
        new Date(d).toLocaleDateString('en-AU', { day: '2-digit', month: 'short', year: 'numeric' });

      const employeeName = `${employee.firstName} ${employee.lastName}`.trim();

      for (const admin of admins) {
        await emailService.sendLeaveRequestEmail({
          to: admin.email,
          employeeName,
          leaveType: leave.leaveType,
          startDate: fmt(leave.startDate),
          endDate: fmt(leave.endDate),
          days: leave.periodDays,
          notes: leave.notes,
        });
      }
    } catch (err) {
      logger.warn('Failed to send admin leave notification:', err.message);
    }
  }
}

module.exports = new LeaveService();
