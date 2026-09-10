/**
 * Master Service
 *
 * Everything the platform master admin does: creating organisations, deciding
 * which modules each one may use, issuing their first admin's credentials, and
 * suspending or reactivating them.
 *
 * The master admin never reads an organisation's own data here — only the
 * organisation record, its admin accounts and headline counts.
 */

const mongoose = require('mongoose');
const Company = require('../models/Company');
const User = require('../models/User');
const Employee = require('../models/Employee');
const Site = require('../models/Site');
const Shift = require('../models/Shift');
const emailService = require('./email.service');
const logger = require('../utils/logger');
const { generateTempPassword } = require('../utils/password');
const { MODULES, MODULE_KEYS, withDependencies, DEFAULT_MODULES } = require('../config/modules');
const { invalidateCompanyAccess } = require('../middleware/moduleAccess');

const ORG_ADMIN_ROLES = ['ADMIN', 'MANAGER'];

const badRequest = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

class MasterService {
  /**
   * The module catalogue, for the master panel to render switches from.
   */
  getModuleCatalogue() {
    return {
      modules: MODULE_KEYS.map((key) => ({ ...MODULES[key] })),
      defaults: [...DEFAULT_MODULES],
    };
  }

  /**
   * Count admins and employees for a set of organisations in two queries
   * rather than two per organisation.
   */
  async _countsFor(companyIds) {
    const ids = companyIds.map(String);

    const [adminGroups, employeeGroups] = await Promise.all([
      User.aggregate([
        { $match: { companyId: { $in: ids }, role: { $in: ORG_ADMIN_ROLES }, deletedAt: null } },
        { $group: { _id: '$companyId', count: { $sum: 1 } } },
      ]),
      Employee.aggregate([
        { $match: { companyId: { $in: ids }, deletedAt: null } },
        { $group: { _id: '$companyId', count: { $sum: 1 } } },
      ]),
    ]);

    const admins = {};
    adminGroups.forEach((row) => { admins[row._id] = row.count; });

    const employees = {};
    employeeGroups.forEach((row) => { employees[row._id] = row.count; });

    return { admins, employees };
  }

  /**
   * Present an organisation for the master panel.
   */
  _shape(company, counts = {}) {
    const id = String(company._id);
    const configured = Array.isArray(company.enabledModules) ? company.enabledModules : [];

    return {
      id,
      name: company.name,
      legalName: company.legalName || '',
      businessNumber: company.businessNumber || '',
      email: company.email,
      phone: company.phone || '',
      address: company.address || {},
      timezone: company.timezone,
      primaryContact: company.primaryContact || {},
      subscription: company.subscription || {},
      isActive: company.isActive !== false,
      // Legacy records with nothing set behave as "everything on" — show that
      // rather than an empty list, so the panel matches what the API allows
      enabledModules: configured.length > 0 ? configured : [...MODULE_KEYS],
      modulesExplicit: configured.length > 0,
      adminCount: counts.admins?.[id] || 0,
      employeeCount: counts.employees?.[id] || 0,
      createdAt: company.createdAt,
      updatedAt: company.updatedAt,
    };
  }

  // =========================================================
  // ORGANISATIONS
  // =========================================================

  async listOrganisations(filters = {}) {
    const {
      search,
      isActive,
      page = 1,
      limit = 25,
      sortBy = 'createdAt',
      order = 'desc',
    } = filters;

    const query = {};

    if (isActive !== undefined && isActive !== '') {
      query.isActive = isActive === 'true' || isActive === true;
    }

    if (search) {
      query.$or = [
        { name: { $regex: search, $options: 'i' } },
        { legalName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
        { businessNumber: { $regex: search, $options: 'i' } },
      ];
    }

    const parsedLimit = Math.min(parseInt(limit, 10) || 25, 100);
    const parsedPage = Math.max(parseInt(page, 10) || 1, 1);
    const skip = (parsedPage - 1) * parsedLimit;

    const [companies, total] = await Promise.all([
      Company.find(query)
        .sort({ [sortBy]: order === 'asc' ? 1 : -1 })
        .skip(skip)
        .limit(parsedLimit)
        .lean(),
      Company.countDocuments(query),
    ]);

    const counts = await this._countsFor(companies.map((c) => c._id));

    return {
      organisations: companies.map((c) => this._shape(c, counts)),
      pagination: {
        total,
        page: parsedPage,
        limit: parsedLimit,
        pages: Math.ceil(total / parsedLimit) || 1,
      },
    };
  }

  async getOrganisation(organisationId) {
    if (!mongoose.Types.ObjectId.isValid(organisationId)) {
      throw badRequest('Invalid organisation ID');
    }

    const company = await Company.findById(organisationId).lean();

    if (!company) {
      throw badRequest('Organisation not found', 404);
    }

    const id = String(company._id);
    const counts = await this._countsFor([id]);

    const [admins, siteCount, shiftCount] = await Promise.all([
      User.find({ companyId: id, role: { $in: ORG_ADMIN_ROLES } })
        .select('name email role isActive lastLoginAt createdAt')
        .sort({ createdAt: 1 })
        .lean(),
      Site.countDocuments({ companyId: id }),
      Shift.countDocuments({ companyId: id }),
    ]);

    return {
      ...this._shape(company, counts),
      siteCount,
      shiftCount,
      admins: admins.map((admin) => ({
        id: String(admin._id),
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive !== false,
        lastLoginAt: admin.lastLoginAt || null,
        createdAt: admin.createdAt,
      })),
    };
  }

  /**
   * Create an organisation, optionally with its first admin.
   *
   * If the admin cannot be created the organisation is removed again, so a
   * failed setup never leaves an organisation nobody can sign in to.
   */
  async createOrganisation(context, data) {
    const { userId } = context;
    const { admin, enabledModules, ...organisation } = data;

    if (!organisation.name || !organisation.email) {
      throw badRequest('An organisation needs a name and an email address');
    }

    const email = String(organisation.email).trim().toLowerCase();

    const clash = await Company.findOne({
      $or: [
        { email },
        ...(organisation.businessNumber ? [{ businessNumber: organisation.businessNumber }] : []),
      ],
    }).lean();

    if (clash) {
      throw badRequest(
        clash.email === email
          ? 'An organisation with this email already exists'
          : 'An organisation with this business number already exists',
        409
      );
    }

    // Pull in dependencies so the selection can never be internally broken
    const modules = enabledModules
      ? withDependencies(enabledModules)
      : [...DEFAULT_MODULES];

    const company = await Company.create({
      ...organisation,
      email,
      enabledModules: modules,
      createdBy: userId,
    });

    logger.info('Organisation created', {
      organisationId: company._id,
      name: company.name,
      modules,
      by: userId,
    });

    let createdAdmin = null;

    if (admin && admin.email) {
      try {
        createdAdmin = await this.createAdmin(context, String(company._id), admin);
      } catch (error) {
        // Roll the organisation back — it has no data yet
        await Company.deleteOne({ _id: company._id });
        invalidateCompanyAccess(String(company._id));
        logger.warn('Rolled back a new organisation because its admin could not be created', {
          name: company.name,
          error: error.message,
        });
        throw error;
      }
    }

    const shaped = await this.getOrganisation(String(company._id));

    return { organisation: shaped, admin: createdAdmin };
  }

  async updateOrganisation(context, organisationId, data) {
    const { userId } = context;

    if (!mongoose.Types.ObjectId.isValid(organisationId)) {
      throw badRequest('Invalid organisation ID');
    }

    const company = await Company.findById(organisationId);

    if (!company) {
      throw badRequest('Organisation not found', 404);
    }

    // Modules and status have their own endpoints
    const blocked = ['enabledModules', 'isActive', '_id', 'companyId', 'createdBy'];
    blocked.forEach((field) => delete data[field]);

    if (data.email) {
      const email = String(data.email).trim().toLowerCase();
      const clash = await Company.findOne({ email, _id: { $ne: company._id } }).lean();
      if (clash) throw badRequest('An organisation with this email already exists', 409);
      data.email = email;
    }

    if (data.businessNumber) {
      const clash = await Company.findOne({
        businessNumber: data.businessNumber,
        _id: { $ne: company._id },
      }).lean();
      if (clash) throw badRequest('An organisation with this business number already exists', 409);
    }

    Object.assign(company, data, { updatedBy: userId });
    await company.save();

    invalidateCompanyAccess(String(company._id));

    return await this.getOrganisation(String(company._id));
  }

  /**
   * Replace an organisation's module list.
   * Dependencies are pulled in automatically; the caller is told what changed.
   */
  async setModules(context, organisationId, requestedModules) {
    const { userId } = context;

    if (!mongoose.Types.ObjectId.isValid(organisationId)) {
      throw badRequest('Invalid organisation ID');
    }

    if (!Array.isArray(requestedModules)) {
      throw badRequest('modules must be an array of module keys');
    }

    const unknown = requestedModules.filter((key) => !MODULE_KEYS.includes(key));

    if (unknown.length > 0) {
      throw badRequest(`Unknown module${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}`);
    }

    const company = await Company.findById(organisationId);

    if (!company) {
      throw badRequest('Organisation not found', 404);
    }

    const resolved = withDependencies(requestedModules);
    const addedForDependencies = resolved.filter((key) => !requestedModules.includes(key));

    company.enabledModules = resolved;
    company.updatedBy = userId;
    await company.save();

    // Take effect immediately rather than when the access cache expires
    invalidateCompanyAccess(String(company._id));

    logger.info('Organisation modules changed', {
      organisationId: company._id,
      modules: resolved,
      addedForDependencies,
      by: userId,
    });

    return {
      organisation: await this.getOrganisation(String(company._id)),
      addedForDependencies,
    };
  }

  /**
   * Suspend or reactivate an organisation.
   * Takes effect on the next request, not when a token expires.
   */
  async setStatus(context, organisationId, { isActive, subscriptionStatus }) {
    const { userId } = context;

    if (!mongoose.Types.ObjectId.isValid(organisationId)) {
      throw badRequest('Invalid organisation ID');
    }

    const company = await Company.findById(organisationId);

    if (!company) {
      throw badRequest('Organisation not found', 404);
    }

    if (isActive !== undefined) {
      company.isActive = isActive === true || isActive === 'true';
    }

    if (subscriptionStatus) {
      const allowed = ['active', 'suspended', 'cancelled'];
      if (!allowed.includes(subscriptionStatus)) {
        throw badRequest(`Subscription status must be one of: ${allowed.join(', ')}`);
      }
      company.subscription = { ...(company.subscription || {}), status: subscriptionStatus };
    }

    company.updatedBy = userId;
    await company.save();

    invalidateCompanyAccess(String(company._id));

    logger.info('Organisation status changed', {
      organisationId: company._id,
      isActive: company.isActive,
      subscriptionStatus: company.subscription?.status,
      by: userId,
    });

    return await this.getOrganisation(String(company._id));
  }

  // =========================================================
  // ORGANISATION ADMINS
  // =========================================================

  /**
   * Create an admin for an organisation and email them their credentials.
   *
   * If the email cannot be sent, the password comes back in the response so it
   * is not lost — that is the only case where it is returned.
   */
  async createAdmin(context, organisationId, data) {
    const { userId } = context;

    if (!mongoose.Types.ObjectId.isValid(organisationId)) {
      throw badRequest('Invalid organisation ID');
    }

    const company = await Company.findById(organisationId).lean();

    if (!company) {
      throw badRequest('Organisation not found', 404);
    }

    const email = String(data.email || '').trim().toLowerCase();
    const name = String(data.name || '').trim();
    const role = ORG_ADMIN_ROLES.includes(data.role) ? data.role : 'ADMIN';

    if (!email || !name) {
      throw badRequest('An admin needs a name and an email address');
    }

    if (data.password && data.password.length < 8) {
      throw badRequest('Password must be at least 8 characters');
    }

    const clash = await User.findOne({ email }).select('_id role').lean();

    if (clash) {
      throw badRequest('A user with this email already exists', 409);
    }

    const password = data.password || generateTempPassword();

    // The pre-save hook hashes this before it reaches the database
    const user = await User.create({
      email,
      name,
      password,
      role,
      companyId: String(company._id),
      isActive: true,
      createdBy: userId,
    });

    const emailResult = await this._sendCredentials({
      user,
      password,
      companyName: company.name,
    });

    logger.info('Organisation admin created', {
      organisationId: company._id,
      userId: user._id,
      role,
      emailSent: emailResult.sent,
      by: userId,
    });

    return {
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      emailSent: emailResult.sent,
      // Only surfaced when the email failed, so the credentials are not lost
      password: emailResult.sent ? undefined : password,
      emailError: emailResult.error,
    };
  }

  /**
   * Issue a fresh password for an existing admin and email it.
   * The previous password stops working immediately.
   */
  async resendCredentials(context, organisationId, targetUserId) {
    const { userId } = context;

    if (!mongoose.Types.ObjectId.isValid(organisationId) ||
        !mongoose.Types.ObjectId.isValid(targetUserId)) {
      throw badRequest('Invalid ID');
    }

    const company = await Company.findById(organisationId).lean();

    if (!company) {
      throw badRequest('Organisation not found', 404);
    }

    const user = await User.findOne({
      _id: targetUserId,
      companyId: String(company._id),
      role: { $in: ORG_ADMIN_ROLES },
    });

    if (!user) {
      throw badRequest('Admin not found in this organisation', 404);
    }

    const password = generateTempPassword();

    user.password = password;
    user.updatedBy = userId;
    await user.save();

    const emailResult = await this._sendCredentials({
      user,
      password,
      companyName: company.name,
    });

    logger.info('Organisation admin credentials reissued', {
      organisationId: company._id,
      userId: user._id,
      emailSent: emailResult.sent,
      by: userId,
    });

    return {
      id: String(user._id),
      email: user.email,
      emailSent: emailResult.sent,
      password: emailResult.sent ? undefined : password,
      emailError: emailResult.error,
    };
  }

  /**
   * Send login credentials, without letting a mail failure break the request.
   */
  async _sendCredentials({ user, password, companyName }) {
    try {
      const result = await emailService.sendWelcomeEmail({
        to: user.email,
        name: user.name,
        email: user.email,
        password,
        role: user.role,
        companyName,
      });

      // A disabled or misconfigured email service reports failure rather than
      // throwing. Treat that as not sent, or the password would be lost — it is
      // only ever stored as a hash.
      if (result && result.success === false) {
        logger.warn('Credentials were not emailed', {
          userId: user._id,
          reason: result.message,
        });
        return { sent: false, error: result.message || 'Email was not sent' };
      }

      return { sent: true };
    } catch (error) {
      logger.error('Could not email credentials', {
        userId: user._id,
        email: user.email,
        error: error.message,
      });
      return { sent: false, error: error.message };
    }
  }

  // =========================================================
  // PLATFORM STATS
  // =========================================================

  async getStats() {
    const startOfMonth = new Date();
    startOfMonth.setDate(1);
    startOfMonth.setHours(0, 0, 0, 0);

    const [
      totalOrganisations,
      activeOrganisations,
      suspendedOrganisations,
      totalAdmins,
      totalEmployees,
      shiftsThisMonth,
    ] = await Promise.all([
      Company.countDocuments({}),
      Company.countDocuments({ isActive: true, 'subscription.status': { $ne: 'suspended' } }),
      Company.countDocuments({
        $or: [{ isActive: false }, { 'subscription.status': { $in: ['suspended', 'cancelled'] } }],
      }),
      User.countDocuments({ role: { $in: ORG_ADMIN_ROLES } }),
      Employee.countDocuments({}),
      Shift.countDocuments({ date: { $gte: startOfMonth } }),
    ]);

    return {
      totalOrganisations,
      activeOrganisations,
      suspendedOrganisations,
      totalAdmins,
      totalEmployees,
      shiftsThisMonth,
    };
  }
}

module.exports = new MasterService();
