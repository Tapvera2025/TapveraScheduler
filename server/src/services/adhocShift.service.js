/**
 * Adhoc Shift Request Service
 *
 * Employees ask for an unplanned shift; an admin or manager approves or rejects
 * it. A pending request is a real Shift row with approvalStatus 'PENDING', so it
 * shows on the employee's own roster but does not count as rostered work and
 * cannot be clocked into until it is approved.
 *
 * Adhoc shifts an admin creates directly are approved on creation — see
 * scheduler.service.js.
 */

const mongoose = require('mongoose');
const { DateTime } = require('luxon');
const Shift = require('../models/Shift');
const Site = require('../models/Site');
const Employee = require('../models/Employee');
const EmployeeSite = require('../models/EmployeeSite');
const Company = require('../models/Company');
const User = require('../models/User');
const emailService = require('./email.service');
const socketService = require('./socket.service');
const logger = require('../utils/logger');

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

class AdhocShiftService {
  /**
   * The employee record behind the logged-in user.
   */
  async _employeeFor(context) {
    const { userId, companyId } = context;

    const employee = await Employee.findOne({
      userId,
      companyId,
      isActive: true,
    }).lean();

    if (!employee) {
      throw fail('No employee record is linked to this account', 404);
    }

    return employee;
  }

  /**
   * Shape a shift for the client, matching the rest of the API.
   */
  _shape(shift) {
    if (!shift) return null;

    const relation = (value) =>
      value && value._id ? { ...value, id: String(value._id) } : value || null;

    return {
      ...shift,
      id: String(shift._id),
      employeeId: relation(shift.employeeId),
      siteId: relation(shift.siteId),
    };
  }

  _populated(query) {
    return query
      .populate('employeeId', 'firstName lastName email position phone')
      .populate('siteId', 'siteLocationName shortName address timezone')
      .populate('reviewedBy', 'name email')
      .lean();
  }

  // =========================================================
  // EMPLOYEE SIDE
  // =========================================================

  /**
   * Request an adhoc shift.
   * Deliberately allows a site the employee is not assigned to — the reviewer
   * decides — but tells the reviewer that is the case.
   */
  async requestShift(context, data) {
    const { companyId, userId } = context;
    const { siteId, date, startTime, endTime, shiftType = 'REGULAR', requestReason = '' } = data;

    if (!mongoose.Types.ObjectId.isValid(siteId)) {
      throw fail('Invalid site ID');
    }

    const site = await Site.findOne({ _id: siteId, companyId, status: 'ACTIVE' }).lean();

    if (!site) {
      throw fail('Site not found or inactive', 404);
    }

    const employee = await this._employeeFor(context);

    const shiftDate = new Date(date);
    const start = new Date(startTime);
    const end = new Date(endTime);

    if ([shiftDate, start, end].some((value) => Number.isNaN(value.getTime()))) {
      throw fail('Invalid date or time');
    }

    if (end <= start) {
      throw fail('The end time must be after the start time');
    }

    // Allow today, refuse anything already in the past
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    if (shiftDate < startOfToday) {
      throw fail('You cannot request a shift for a date in the past');
    }

    // Refuse anything overlapping a shift they already have
    const overlapping = await Shift.findOne({
      companyId,
      employeeId: employee._id,
      approvalStatus: { $nin: ['REJECTED', 'WITHDRAWN'] },
      status: { $ne: 'CANCELLED' },
      startTime: { $lt: end },
      endTime: { $gt: start },
    }).lean();

    if (overlapping) {
      throw fail(
        overlapping.approvalStatus === 'PENDING'
          ? 'You already have a pending request that overlaps these times'
          : 'You already have a shift that overlaps these times',
        409
      );
    }

    const assignment = await EmployeeSite.findOne({
      employeeId: employee._id,
      siteId,
      companyId,
      isActive: true,
    }).lean();

    const shift = await Shift.create({
      companyId,
      employeeId: employee._id,
      siteId,
      date: shiftDate,
      startTime: start,
      endTime: end,
      shiftType,
      status: 'SCHEDULED',
      isAdhoc: true,
      approvalStatus: 'PENDING',
      requestedBy: userId,
      requestedAt: new Date(),
      requestReason,
      createdBy: userId,
    });

    logger.info('Adhoc shift requested', {
      shiftId: shift._id,
      employeeId: employee._id,
      siteId,
      companyId,
      assignedToSite: Boolean(assignment),
    });

    const populated = await this._populated(Shift.findById(shift._id));

    // Tell managers, then email them, without letting either break the request
    try {
      socketService.notifyAdhocRequested({
        companyId: String(companyId),
        employeeName: `${employee.firstName} ${employee.lastName}`,
        siteName: site.siteLocationName,
        shiftId: String(shift._id),
      });
    } catch (error) {
      logger.warn('Could not push the adhoc request notification', { error: error.message });
    }

    this._emailReviewers({ companyId, employee, site, shift: populated }).catch((error) =>
      logger.warn('Could not email reviewers about an adhoc request', { error: error.message })
    );

    return {
      ...this._shape(populated),
      employeeAssignedToSite: Boolean(assignment),
    };
  }

  /**
   * The logged-in employee's own adhoc requests.
   */
  async listMyRequests(context, filters = {}) {
    const { companyId } = context;
    const { status } = filters;

    const employee = await this._employeeFor(context);

    const query = {
      companyId,
      employeeId: employee._id,
      isAdhoc: true,
      approvalStatus: { $ne: null },
    };

    if (status) {
      query.approvalStatus = String(status).toUpperCase();
    }

    const shifts = await this._populated(
      Shift.find(query).sort({ requestedAt: -1, date: -1 })
    );

    return shifts.map((shift) => this._shape(shift));
  }

  /**
   * Withdraw a request that has not been reviewed yet.
   */
  async withdrawMyRequest(context, shiftId) {
    const { companyId, userId } = context;

    if (!mongoose.Types.ObjectId.isValid(shiftId)) {
      throw fail('Invalid request ID');
    }

    const employee = await this._employeeFor(context);

    const shift = await Shift.findOne({
      _id: shiftId,
      companyId,
      employeeId: employee._id,
      isAdhoc: true,
    });

    if (!shift) {
      throw fail('Request not found', 404);
    }

    if (shift.approvalStatus !== 'PENDING') {
      throw fail('Only a pending request can be withdrawn');
    }

    shift.approvalStatus = 'WITHDRAWN';
    shift.status = 'CANCELLED';
    shift.updatedBy = userId;
    await shift.save();

    logger.info('Adhoc shift request withdrawn', {
      shiftId: shift._id,
      employeeId: employee._id,
    });

    return this._shape(await this._populated(Shift.findById(shift._id)));
  }

  // =========================================================
  // REVIEWER SIDE
  // =========================================================

  /**
   * The review queue. Defaults to what still needs a decision.
   */
  async listRequests(context, filters = {}) {
    const { companyId } = context;
    const {
      status = 'PENDING',
      siteId,
      page = 1,
      limit = 25,
    } = filters;

    const query = {
      companyId,
      isAdhoc: true,
      approvalStatus: { $ne: null },
    };

    if (status && status !== 'ALL') {
      query.approvalStatus = String(status).toUpperCase();
    }

    if (siteId && mongoose.Types.ObjectId.isValid(siteId)) {
      query.siteId = siteId;
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 25, 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);

    const [shifts, total] = await Promise.all([
      this._populated(
        Shift.find(query)
          .sort({ requestedAt: -1, date: -1 })
          .skip((parsedPage - 1) * parsedLimit)
          .limit(parsedLimit)
      ),
      Shift.countDocuments(query),
    ]);

    return {
      requests: shifts.map((shift) => this._shape(shift)),
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }

  /**
   * Counts by state, for the dashboard widget.
   */
  async getStats(context) {
    const { companyId } = context;

    const rows = await Shift.aggregate([
      { $match: { companyId: String(companyId), isAdhoc: true, approvalStatus: { $ne: null }, deletedAt: null } },
      { $group: { _id: '$approvalStatus', count: { $sum: 1 } } },
    ]);

    const stats = { pending: 0, approved: 0, rejected: 0, withdrawn: 0 };

    rows.forEach((row) => {
      const key = String(row._id || '').toLowerCase();
      if (key in stats) stats[key] = row.count;
    });

    return stats;
  }

  /**
   * Approve or reject a pending request.
   */
  async review(context, shiftId, { approve, note = '' }) {
    const { companyId, userId } = context;

    if (!mongoose.Types.ObjectId.isValid(shiftId)) {
      throw fail('Invalid request ID');
    }

    const shift = await Shift.findOne({
      _id: shiftId,
      companyId,
      isAdhoc: true,
    });

    if (!shift) {
      throw fail('Request not found', 404);
    }

    if (shift.approvalStatus !== 'PENDING') {
      throw fail(`This request has already been ${String(shift.approvalStatus).toLowerCase()}`);
    }

    shift.approvalStatus = approve ? 'APPROVED' : 'REJECTED';
    shift.status = approve ? 'SCHEDULED' : 'CANCELLED';
    shift.reviewedBy = userId;
    shift.reviewedAt = new Date();
    shift.reviewNote = note;
    shift.updatedBy = userId;
    await shift.save();

    const populated = await this._populated(Shift.findById(shift._id));

    logger.info('Adhoc shift request reviewed', {
      shiftId: shift._id,
      decision: shift.approvalStatus,
      by: userId,
    });

    // Tell the employee, both live and by email
    try {
      socketService.notifyAdhocReviewed({
        companyId: String(companyId),
        employeeId: String(shift.employeeId),
        approved: approve,
        note,
        shift: populated,
      });
    } catch (error) {
      logger.warn('Could not push the adhoc decision notification', { error: error.message });
    }

    this._emailDecision({ companyId, shift: populated, approved: approve, note }).catch((error) =>
      logger.warn('Could not email the adhoc decision', { error: error.message })
    );

    return this._shape(populated);
  }

  // =========================================================
  // EMAIL
  // =========================================================

  async _formatTimes(companyId, shift) {
    const company = await Company.findById(companyId).select('timezone').lean();
    const timezone = company?.timezone || 'Australia/Sydney';

    return {
      date: DateTime.fromJSDate(new Date(shift.date)).setZone(timezone).toFormat('dd/MM/yyyy'),
      start: DateTime.fromJSDate(new Date(shift.startTime)).setZone(timezone).toFormat('HH:mm'),
      end: DateTime.fromJSDate(new Date(shift.endTime)).setZone(timezone).toFormat('HH:mm'),
    };
  }

  async _emailReviewers({ companyId, employee, site, shift }) {
    const reviewers = await User.find({
      companyId: String(companyId),
      role: { $in: ['ADMIN', 'MANAGER'] },
      isActive: true,
    })
      .select('email name')
      .lean();

    if (reviewers.length === 0) return;

    const when = await this._formatTimes(companyId, shift);

    await Promise.all(
      reviewers.map((reviewer) =>
        emailService
          .sendNotificationEmail({
            to: reviewer.email,
            subject: 'Adhoc shift request awaiting approval',
            message:
              `${employee.firstName} ${employee.lastName} has requested an adhoc shift at ` +
              `${site.siteLocationName} on ${when.date}, ${when.start}–${when.end}.` +
              (shift.requestReason ? `\n\nReason given: ${shift.requestReason}` : ''),
            actionText: 'Review the request',
          })
          .catch((error) =>
            logger.warn('Adhoc reviewer email failed', {
              to: reviewer.email,
              error: error.message,
            })
          )
      )
    );
  }

  async _emailDecision({ companyId, shift, approved, note }) {
    const email = shift.employeeId?.email;
    if (!email) return;

    const when = await this._formatTimes(companyId, shift);
    const siteName = shift.siteId?.siteLocationName || 'the site';

    await emailService.sendNotificationEmail({
      to: email,
      subject: `Adhoc shift ${approved ? 'approved' : 'declined'}`,
      message:
        `Your adhoc shift request at ${siteName} on ${when.date}, ${when.start}–${when.end} has been ` +
        `${approved ? 'approved' : 'declined'}.` +
        (note ? `\n\nNote: ${note}` : ''),
      actionText: approved ? 'View your roster' : undefined,
    });
  }
}

module.exports = new AdhocShiftService();
