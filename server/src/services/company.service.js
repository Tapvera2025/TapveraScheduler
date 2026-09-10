/**
 * Company Service (an organisation's own settings)
 *
 * Everything here is scoped to the caller's own organisation. Creating,
 * deleting, suspending an organisation and deciding its modules belong to the
 * master admin — see master.service.js — so those operations are deliberately
 * absent, and the fields behind them cannot be written from here.
 *
 * Note: the Company model has no companyId of its own; it IS the tenant root.
 */

const Company = require('../models/Company');
const Employee = require('../models/Employee');
const Site = require('../models/Site');
const Shift = require('../models/Shift');
const User = require('../models/User');
const mongoose = require('mongoose');

// The only fields an organisation may change about itself. Anything else — and
// in particular enabledModules, isActive and subscription — is master-only.
const EDITABLE_FIELDS = [
  'name',
  'legalName',
  'businessNumber',
  'email',
  'phone',
  'address',
  'timezone',
  'settings',
  'primaryContact',
];

const SETTINGS_FIELDS = ['dateFormat', 'timeFormat', 'currency', 'language'];

const fail = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

class CompanyService {
  /**
   * Reject anything but the caller's own organisation.
   */
  _assertOwn(context, companyId) {
    const { companyId: userCompanyId } = context;

    if (!mongoose.Types.ObjectId.isValid(companyId)) {
      throw fail('Invalid company ID');
    }

    if (!userCompanyId || String(companyId) !== String(userCompanyId)) {
      throw fail('Access denied', 403);
    }
  }

  /**
   * Keep only the fields an organisation is allowed to change.
   */
  _pickEditable(data = {}) {
    const clean = {};

    EDITABLE_FIELDS.forEach((field) => {
      if (data[field] === undefined) return;

      if (field === 'settings') {
        const settings = {};
        SETTINGS_FIELDS.forEach((key) => {
          if (data.settings && data.settings[key] !== undefined) {
            settings[key] = data.settings[key];
          }
        });
        if (Object.keys(settings).length > 0) clean.settings = settings;
        return;
      }

      clean[field] = data[field];
    });

    return clean;
  }

  /**
   * The caller's own organisation. Kept as a list-shaped response because that
   * is what the route has always returned.
   */
  async getAllCompanies(context) {
    const company = await Company.findById(context.companyId).lean();

    const companies = company ? [company] : [];

    return {
      companies,
      pagination: {
        total: companies.length,
        page: 1,
        limit: 1,
        pages: 1,
      },
    };
  }

  /**
   * The caller's own organisation, by id.
   */
  async getCompanyById(context, companyId) {
    this._assertOwn(context, companyId);

    const company = await Company.findById(companyId).lean();

    if (!company) {
      throw fail('Company not found', 404);
    }

    return company;
  }

  /**
   * The caller's own organisation, without needing to know its id.
   */
  async getMyCompany(context) {
    if (!context.companyId) {
      throw fail('This account is not linked to an organisation', 403);
    }

    const company = await Company.findById(context.companyId).lean();

    if (!company) {
      throw fail('Company not found', 404);
    }

    return company;
  }

  /**
   * Update the caller's own organisation. Only whitelisted fields are applied.
   */
  async updateCompany(context, companyId, data) {
    const { userId, role } = context;

    if (role !== 'ADMIN' && role !== 'MANAGER') {
      throw fail('Access denied', 403);
    }

    this._assertOwn(context, companyId);

    const company = await Company.findById(companyId);

    if (!company) {
      throw fail('Company not found', 404);
    }

    const update = this._pickEditable(data);

    if (update.businessNumber && update.businessNumber !== company.businessNumber) {
      const clash = await Company.findOne({
        businessNumber: update.businessNumber,
        _id: { $ne: companyId },
      }).lean();

      if (clash) {
        throw fail('Company with this business number already exists', 409);
      }
    }

    if (update.email && update.email !== company.email) {
      const clash = await Company.findOne({
        email: update.email,
        _id: { $ne: companyId },
      }).lean();

      if (clash) {
        throw fail('Company with this email already exists', 409);
      }
    }

    // Merge settings rather than replacing the whole sub-document
    if (update.settings) {
      company.settings = { ...(company.settings?.toObject?.() || company.settings || {}), ...update.settings };
      delete update.settings;
    }

    Object.assign(company, update);
    company.updatedBy = userId;

    await company.save();

    return company.toObject();
  }

  /**
   * Update the caller's own organisation without needing its id.
   */
  async updateMyCompany(context, data) {
    if (!context.companyId) {
      throw fail('This account is not linked to an organisation', 403);
    }

    return await this.updateCompany(context, String(context.companyId), data);
  }

  /**
   * Headline counts for the caller's own organisation.
   */
  async getCompanyStats(context, companyId) {
    const { role } = context;

    if (role !== 'ADMIN' && role !== 'MANAGER') {
      throw fail('Access denied', 403);
    }

    this._assertOwn(context, companyId);

    const company = await Company.findById(companyId);

    if (!company) {
      throw fail('Company not found', 404);
    }

    const [
      totalEmployees,
      activeEmployees,
      totalSites,
      activeSites,
      totalUsers,
      activeUsers,
      totalShifts,
      upcomingShifts,
    ] = await Promise.all([
      Employee.countDocuments({ companyId }),
      Employee.countDocuments({ companyId, isActive: true }),
      Site.countDocuments({ companyId }),
      Site.countDocuments({ companyId, status: 'ACTIVE' }),
      User.countDocuments({ companyId }),
      User.countDocuments({ companyId, isActive: true }),
      Shift.countDocuments({ companyId }),
      Shift.countDocuments({
        companyId,
        date: { $gte: new Date() },
        status: { $in: ['SCHEDULED', 'IN_PROGRESS'] },
      }),
    ]);

    return {
      companyId,
      companyName: company.name,
      employees: { total: totalEmployees, active: activeEmployees },
      sites: { total: totalSites, active: activeSites },
      users: { total: totalUsers, active: activeUsers },
      shifts: { total: totalShifts, upcoming: upcomingShifts },
      subscription: company.subscription,
    };
  }
}

module.exports = new CompanyService();
