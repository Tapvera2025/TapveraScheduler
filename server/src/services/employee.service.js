/**
 * Employee Service
 *
 * Business logic for employee management with multi-tenant isolation
 */

const Employee = require('../models/Employee');
const EmployeeSite = require('../models/EmployeeSite');
const User = require('../models/User');
const Company = require('../models/Company');
const mongoose = require('mongoose');
const emailService = require('./email.service');
const logger = require('../utils/logger');
// The one generator, shared with master.service and the CLI scripts. The copy
// that used to live here built passwords from Math.random(), which is seeded
// predictably and is not safe for a credential.
const { generateTempPassword } = require('../utils/password');

class EmployeeService {
  /**
   * Get all employees with filters and pagination
   * @param {Object} context - { companyId, userId, role }
   * @param {Object} filters - { search, isActive, department, position, page, limit, sortBy, order }
   * @returns {Promise<Object>} - { employees, pagination }
   */
  async getAllEmployees(context, filters = {}) {
    const { companyId } = context;
    const {
      search,
      isActive,
      department,
      position,
      page = 1,
      limit = 25,
      sortBy = 'createdAt',
      order = 'desc',
    } = filters;

    // Build query with multi-tenant filter
    const query = { companyId };

    // Apply filters
    if (isActive !== undefined) {
      query.isActive = isActive === 'true' || isActive === true;
    }

    if (department) {
      query.department = department;
    }

    if (position) {
      query.position = position;
    }

    if (search) {
      query.$or = [
        { firstName: { $regex: search, $options: 'i' } },
        { lastName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { employeeNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const skip = (page - 1) * limit;
    const sortOrder = order === 'desc' ? -1 : 1;

    const [employees, total] = await Promise.all([
      Employee.find(query)
        .select('-tfn') // Never return TFN
        .populate('userId', 'lastLoginAt')
        .sort({ [sortBy]: sortOrder })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Employee.countDocuments(query),
    ]);

    // Transform _id to id for frontend compatibility
    const transformedEmployees = employees.map(emp => ({
      ...emp,
      id: emp._id.toString(),
      lastLoginAt: emp.userId?.lastLoginAt ?? null,
    }));

    return {
      employees: transformedEmployees,
      pagination: {
        total,
        page: parseInt(page),
        limit: parseInt(limit),
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get single employee by ID
   * @param {Object} context - { companyId, userId, role }
   * @param {String} employeeId
   * @returns {Promise<Object>} - Employee document
   */
  async getEmployeeById(context, employeeId) {
    const { companyId } = context;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      const error = new Error('Invalid employee ID');
      error.statusCode = 400;
      throw error;
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      companyId,
    })
      .select('-tfn') // Never return TFN
      .populate('userId', 'name email role isActive lastLoginAt') // Populate user details
      .lean();

    if (!employee) {
      const error = new Error('Employee not found');
      error.statusCode = 404;
      throw error;
    }

    // Get assigned sites
    const siteAssignments = await EmployeeSite.find({
      employeeId,
      isActive: true,
    })
      .populate('siteId', 'siteLocationName shortName address')
      .lean();

    return {
      ...employee,
      id: employee._id.toString(),
      assignedSites: siteAssignments,
    };
  }

  /**
   * Create a new employee
   * @param {Object} context - { companyId, userId }
   * @param {Object} data - Employee data
   * @returns {Promise<Object>} - Created employee
   */
  async createEmployee(context, data) {
    const { companyId, userId } = context;

    // Ensure companyId is present
    if (!companyId) {
      const error = new Error('Company ID is required');
      error.statusCode = 400;
      throw error;
    }

    // If userId is provided, validate it
    if (data.userId) {
      if (!mongoose.Types.ObjectId.isValid(data.userId)) {
        const error = new Error('Invalid user ID');
        error.statusCode = 400;
        throw error;
      }

      // Check if user exists and belongs to same company
      const user = await User.findOne({
        _id: data.userId,
        companyId,
      });

      if (!user) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      // Validate that email matches user's email
      if (user.email.toLowerCase() !== data.email.toLowerCase()) {
        const error = new Error(
          'Employee email must match the linked user account email'
        );
        error.statusCode = 400;
        throw error;
      }

      // Check if userId is already linked to another employee in this company
      const existingEmployeeWithUser = await Employee.findOne({
        userId: data.userId,
        companyId,
      });

      if (existingEmployeeWithUser) {
        const error = new Error('This user is already linked to an employee');
        error.statusCode = 409;
        throw error;
      }
    }

    // Full email validation: format, disposable, cross-collection uniqueness,
    // MX deliverability. When the employee is being linked to an existing
    // User (data.userId already validated above), exclude that user from the
    // uniqueness check — sharing an email with your own User is legitimate.
    const { validateAccountEmail } = require('../utils/emailValidation');
    const emailCheck = await validateAccountEmail({
      email: data.email,
      companyId,
      excludeUserId: data.userId || undefined,
    });
    if (!emailCheck.ok) {
      const error = new Error(emailCheck.message);
      error.statusCode = emailCheck.code === 'EMAIL_IN_USE' ? 409 : 400;
      error.code = emailCheck.code;
      throw error;
    }
    data.email = emailCheck.email;

    // Check for duplicate employee number if provided (within the company)
    if (data.employeeNumber) {
      const existingByNumber = await Employee.findOne({
        employeeNumber: data.employeeNumber,
        companyId,
      });

      if (existingByNumber) {
        const error = new Error(
          'Employee with this employee number already exists'
        );
        error.statusCode = 409;
        throw error;
      }
    }

    // Auto-create a User account so the employee can sign in, when the caller
    // supplied a password or asked for a login to be created.
    let createdUserId = data.userId;
    let plainPassword = data.password; // Store for email
    let shouldSendEmail = false;

    logger.info('Employee creation - checking email conditions', {
      hasUserId: !!data.userId,
      hasPassword: !!data.password,
      sendInvitation: data.sendInvitation,
      email: data.email,
    });

    // A caller that wants the employee to be able to sign in, but has no
    // business choosing their password, sets createLogin instead of password.
    // The generated value is emailed to the employee and never returned, so it
    // does not pass back through the caller.
    const wantsLogin = Boolean(data.password) || data.createLogin === true;
    delete data.createLogin;

    if (!data.userId && wantsLogin) {
      // Check if user with this email already exists
      const existingUser = await User.findOne({
        email: data.email,
        companyId,
      });

      if (!existingUser) {
        const loginPassword = data.password || generateTempPassword();
        plainPassword = loginPassword;
        // Create user account for the employee
        logger.info('Creating new user account for employee', { email: data.email });
        const newUser = await User.create({
          email: data.email,
          password: loginPassword,
          name: `${data.firstName} ${data.lastName}`,
          role: 'USER', // Employees get USER role by default
          companyId,
          createdBy: userId,
        });
        createdUserId = newUser._id;
        shouldSendEmail = true; // Send email for newly created user
        logger.info('User created - will send email', { userId: newUser._id, sendInvitation: data.sendInvitation });
      } else {
        // Use existing user account but send email if sendInvitation is true
        logger.info('User already exists - linking to employee', { email: data.email, userId: existingUser._id });
        createdUserId = existingUser._id;
        // If sendInvitation is enabled, send email even for existing users
        if (data.sendInvitation !== false) {
          shouldSendEmail = true;
          logger.info('Will send email for existing user (sendInvitation=true)');
        }
      }
    } else {
      logger.info('Skipping user creation - no password or userId provided', {
        hasUserId: !!data.userId,
        hasPassword: !!data.password,
      });
    }

    // Create employee with context
    const employee = await Employee.create({
      ...data,
      userId: createdUserId, // Link to user account
      companyId,
      createdBy: userId,
    });

    // Send welcome email if a new user account was created AND sendInvitation is true.
    // Fire-and-forget: SMTP delivery must not block the HTTP response.
    if (shouldSendEmail && plainPassword && data.sendInvitation !== false) {
      Company.findById(companyId)
        .then((company) =>
          emailService.sendWelcomeEmail({
            to: data.email,
            name: `${data.firstName} ${data.lastName}`,
            email: data.email,
            password: plainPassword,
            role: 'USER',
            companyName: company?.name || 'Your Company',
          })
        )
        .then(() => logger.info('Welcome email sent to employee', { employeeId: employee._id }))
        .catch((emailError) =>
          logger.error('Failed to send welcome email to employee', {
            employeeId: employee._id,
            email: data.email,
            error: emailError.message,
          })
        );
    }

    // Remove TFN from response
    const employeeObj = employee.toObject();
    delete employeeObj.tfn;
    delete employeeObj.password; // Don't return password

    return {
      ...employeeObj,
      id: employeeObj._id.toString()
    };
  }

  /**
   * Update an employee
   * @param {Object} context - { companyId, userId }
   * @param {String} employeeId
   * @param {Object} data - Update data
   * @returns {Promise<Object>} - Updated employee
   */
  async updateEmployee(context, employeeId, data) {
    const { companyId, userId } = context;
    // Login fields belong to User, never to the employee profile.
    const { password, sendInvitation = true, ...profileData } = data;
    data = profileData;

    if (password && (typeof password !== 'string' || password.length < 8)) {
      const error = new Error('Password must be at least 8 characters');
      error.statusCode = 400;
      throw error;
    }

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      const error = new Error('Invalid employee ID');
      error.statusCode = 400;
      throw error;
    }

    // Find employee and verify ownership
    const employee = await Employee.findOne({
      _id: employeeId,
      companyId,
    });

    if (!employee) {
      const error = new Error('Employee not found');
      error.statusCode = 404;
      throw error;
    }

    // If updating userId, validate it
    if (data.userId) {
      if (!mongoose.Types.ObjectId.isValid(data.userId)) {
        const error = new Error('Invalid user ID');
        error.statusCode = 400;
        throw error;
      }

      // Check if user exists and belongs to same company
      const user = await User.findOne({
        _id: data.userId,
        companyId,
      });

      if (!user) {
        const error = new Error('User not found');
        error.statusCode = 404;
        throw error;
      }

      // Get the email to validate (either from data or existing employee)
      const emailToValidate = data.email || employee.email;

      // Validate that email matches user's email
      if (user.email.toLowerCase() !== emailToValidate.toLowerCase()) {
        const error = new Error(
          'Employee email must match the linked user account email'
        );
        error.statusCode = 400;
        throw error;
      }

      // Check if userId is already linked to another employee in this company
      const existingEmployeeWithUser = await Employee.findOne({
        userId: data.userId,
        companyId,
        _id: { $ne: employeeId },
      });

      if (existingEmployeeWithUser) {
        const error = new Error(
          'This user is already linked to another employee'
        );
        error.statusCode = 409;
        throw error;
      }
    }

    // Exclude this employee and its linked account, which legitimately share
    // an email. Any supplied replacement userId has been validated above.
    let linkedUserId = data.userId === undefined ? employee.userId : data.userId;

    // Normalise the incoming email early so we can accurately detect whether
    // it actually changed.  Only run the full uniqueness check (format +
    // disposable + MX + cross-collection) when the address is genuinely new;
    // re-validating an unchanged email against itself would always find the
    // existing records and produce a false "already in use" rejection.
    const incomingEmail = data.email ? data.email.trim().toLowerCase() : null;
    const emailIsChanging = incomingEmail !== null && incomingEmail !== (employee.email || '');

    // When the employee has no login yet but a password is being set, look for
    // an existing User with this email so we can link and update in place
    // rather than block (or create a duplicate).  This handles the case where a
    // previous save partially succeeded – User created but employee.userId not
    // yet written – leaving an "orphaned" User record.
    let orphanedUser = null;
    if (!linkedUserId && password) {
      const emailToSearch = incomingEmail || (employee.email || '').trim().toLowerCase();
      orphanedUser = await User.findOne({ email: emailToSearch, companyId });
      if (orphanedUser) linkedUserId = orphanedUser._id;
    }

    if (emailIsChanging || (password && !linkedUserId)) {
      const { validateAccountEmail } = require('../utils/emailValidation');
      const emailCheck = await validateAccountEmail({
        email: incomingEmail || employee.email,
        companyId,
        excludeEmployeeId: employeeId,
        excludeUserId: linkedUserId,
      });
      if (!emailCheck.ok) {
        const error = new Error(emailCheck.message);
        error.statusCode = emailCheck.code === 'EMAIL_IN_USE' ? 409 : 400;
        error.code = emailCheck.code;
        throw error;
      }
      data.email = emailCheck.email;
    } else if (incomingEmail) {
      // Email unchanged — just carry the normalised form forward.
      data.email = incomingEmail;
    }

    // Check if updating employee number, ensure no duplicates within company
    if (data.employeeNumber) {
      const existingByNumber = await Employee.findOne({
        employeeNumber: data.employeeNumber,
        companyId,
        _id: { $ne: employeeId },
      });

      if (existingByNumber) {
        const error = new Error(
          'Employee with this employee number already exists'
        );
        error.statusCode = 409;
        throw error;
      }
    }

    // Don't allow updating TFN or companyId through this endpoint
    delete data.tfn;
    delete data.companyId;

    // Check if email is being changed
    const emailChanged = data.email && data.email !== employee.email;

    // Update employee
    Object.assign(employee, data);
    employee.updatedBy = userId;

    // Validate the profile before changing credentials. Account persistence
    // errors must fail the request rather than be treated as email failures.
    await employee.validate();

    let loginUser;
    let plainPassword;
    if (employee.userId && (password || emailChanged)) {
      loginUser = await User.findOne({ _id: employee.userId, companyId });

      if (!loginUser) {
        const error = new Error('Linked user account not found');
        error.statusCode = 404;
        throw error;
      }

      // Keep the existing temporary-password flow for email-only changes,
      // but always use an explicitly supplied password when there is one.
      plainPassword = password || generateTempPassword();
      loginUser.email = employee.email;
      loginUser.password = plainPassword;
      loginUser.updatedBy = userId;
      await loginUser.save(); // User's pre-save hook hashes the password.
    } else if (password) {
      plainPassword = password;
      if (orphanedUser) {
        // Re-use the existing account rather than creating a duplicate.
        loginUser = orphanedUser;
        loginUser.email = employee.email;
        loginUser.password = plainPassword;
        loginUser.updatedBy = userId;
        await loginUser.save();
      } else {
        loginUser = await User.create({
          email: employee.email,
          password: plainPassword,
          name: `${employee.firstName} ${employee.lastName}`,
          role: 'USER',
          companyId,
          createdBy: userId,
        });
      }
      employee.userId = loginUser._id;
    }

    await employee.save();

    // Fire-and-forget: credentials are already saved, SMTP delivery must not
    // block the HTTP response.
    if (loginUser && plainPassword && sendInvitation !== false) {
      const _role = loginUser.role;
      Company.findById(companyId)
        .then((company) =>
          emailService.sendWelcomeEmail({
            to: employee.email,
            name: `${employee.firstName} ${employee.lastName}`,
            email: employee.email,
            password: plainPassword,
            role: _role,
            companyName: company?.name || 'Your Company',
          })
        )
        .then(() => logger.info('Credentials sent after employee update', { employeeId: employee._id }))
        .catch((emailError) =>
          logger.error('Failed to send credentials after employee update', {
            employeeId: employee._id,
            error: emailError.message,
          })
        );
    }

    // Remove TFN from response
    const employeeObj = employee.toObject();
    delete employeeObj.tfn;

    return {
      ...employeeObj,
      id: employeeObj._id.toString()
    };
  }

  /**
   * Delete an employee (soft delete)
   * @param {Object} context - { companyId, userId }
   * @param {String} employeeId
   * @returns {Promise<Object>} - Success message
   */
  async deleteEmployee(context, employeeId) {
    const { companyId, userId } = context;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      const error = new Error('Invalid employee ID');
      error.statusCode = 400;
      throw error;
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      companyId,
    });

    if (!employee) {
      const error = new Error('Employee not found');
      error.statusCode = 404;
      throw error;
    }

    // Set deletedBy before soft delete
    employee.deletedBy = userId;

    // Soft delete if plugin is available
    if (typeof employee.softDelete === 'function') {
      await employee.softDelete();
    } else {
      employee.deletedAt = new Date();
      await employee.save();
    }

    // Cascade-cancel every future SCHEDULED shift so gaps become visible to
    // the admin and the absence-detection cron does not chase a deleted
    // employee. Past and completed shifts stay intact for payroll/audit.
    const Shift = require('../models/Shift');
    const cancellation = await Shift.updateMany(
      {
        employeeId,
        companyId,
        status: 'SCHEDULED',
        startTime: { $gt: new Date() },
        deletedAt: null,
      },
      {
        $set: {
          status: 'CANCELLED',
          reviewNote: 'Auto-cancelled: employee removed from the roster',
          reviewedBy: userId,
          reviewedAt: new Date(),
        },
      }
    );

    // Deactivate all site assignments so the employee stops appearing on any
    // site's roster. Stamped with the deletion timestamp so restoreEmployee
    // can identify exactly which assignments to reactivate.
    const deletedAt = employee.deletedAt || new Date();
    await EmployeeSite.updateMany(
      { employeeId, companyId, isActive: true },
      { isActive: false, unassignedAt: deletedAt }
    );

    return {
      success: true,
      message: 'Employee deleted successfully',
      cancelledShifts: cancellation.modifiedCount || 0,
    };
  }

  /**
   * Restore a soft-deleted employee. Clears deletedAt so the employee record
   * comes back with all their profile data. Does NOT restore:
   *   - Cancelled shifts    — those were cover arrangements the admin made
   *                           after removal; reinstating them would create
   *                           duplicate roster entries.
   *   - Site assignments    — reactivated only if their unassignedAt matches
   *                           the deletion timestamp within a small window,
   *                           i.e. they were deactivated by delete rather
   *                           than by an explicit earlier unassignment.
   */
  async restoreEmployee(context, employeeId) {
    const { companyId, userId } = context;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      const error = new Error('Invalid employee ID');
      error.statusCode = 400;
      throw error;
    }

    // Bypass softDelete's default query filter so we can find the deleted row.
    const employee = await Employee.findOne({ _id: employeeId, companyId })
      .setOptions({ _bypassSoftDelete: true });

    if (!employee) {
      const error = new Error('Employee not found');
      error.statusCode = 404;
      throw error;
    }
    if (!employee.deletedAt) {
      const error = new Error('Employee is not deleted');
      error.statusCode = 409;
      throw error;
    }

    const deletionTime = new Date(employee.deletedAt);
    employee.deletedAt = null;
    employee.deletedBy = null;
    employee.updatedBy = userId;
    await employee.save();

    // Reactivate only the site assignments that were closed as part of the
    // delete — matched by unassignedAt sitting within a one-minute window of
    // the deletion timestamp. Assignments the admin ended earlier stay ended.
    const windowStart = new Date(deletionTime.getTime() - 60 * 1000);
    const windowEnd = new Date(deletionTime.getTime() + 60 * 1000);
    const restored = await EmployeeSite.updateMany(
      {
        employeeId,
        companyId,
        isActive: false,
        unassignedAt: { $gte: windowStart, $lte: windowEnd },
      },
      { $set: { isActive: true }, $unset: { unassignedAt: '' } }
    );

    return {
      success: true,
      message: 'Employee restored successfully',
      restoredSiteAssignments: restored.modifiedCount || 0,
    };
  }

  /**
   * Assign employee to multiple sites
   * @param {Object} context - { companyId, userId }
   * @param {String} employeeId
   * @param {Array<String>} siteIds
   * @returns {Promise<Array>} - EmployeeSite assignments
   */
  async assignToSites(context, employeeId, siteIds) {
    const { companyId, userId } = context;

    if (!mongoose.Types.ObjectId.isValid(employeeId)) {
      const error = new Error('Invalid employee ID');
      error.statusCode = 400;
      throw error;
    }

    if (!Array.isArray(siteIds) || siteIds.length === 0) {
      const error = new Error('Site IDs array is required');
      error.statusCode = 400;
      throw error;
    }

    const employee = await Employee.findOne({
      _id: employeeId,
      companyId,
    });

    if (!employee) {
      const error = new Error('Employee not found');
      error.statusCode = 404;
      throw error;
    }

    if (!employee.isActive) {
      const error = new Error('Cannot assign sites to inactive employees');
      error.statusCode = 400;
      throw error;
    }

    const assignments = await Promise.all(
      siteIds.map(async (siteId) => {
        if (!mongoose.Types.ObjectId.isValid(siteId)) {
          const error = new Error(`Invalid site ID: ${siteId}`);
          error.statusCode = 400;
          throw error;
        }

        // Check if already assigned
        const existing = await EmployeeSite.findOne({
          employeeId,
          siteId,
          companyId,
        });

        if (existing) {
          // Reactivate if inactive
          if (!existing.isActive) {
            existing.isActive = true;
            existing.assignedAt = new Date();
            existing.unassignedAt = null;
            await existing.save();
          }
          return existing.toObject();
        }

        // Create new assignment
        const assignment = await EmployeeSite.create({
          employeeId,
          siteId,
          companyId,
          createdBy: userId,
        });

        return assignment.toObject();
      })
    );

    return assignments;
  }
}

module.exports = new EmployeeService();
