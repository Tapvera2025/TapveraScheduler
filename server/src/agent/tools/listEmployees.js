/**
 * listEmployees — who works here?
 *
 * Optionally filtered to a site. Returns name, position, department, phone.
 * Pay, address and personal identifiers are deliberately excluded.
 */

const Employee = require('../../models/Employee');
const EmployeeSite = require('../../models/EmployeeSite');
const Site = require('../../models/Site');
const { resolveSite } = require('../resolver');
const mongoose = require('mongoose');

const MAX_ROWS = 100;

const parameters = {
  type: 'object',
  properties: {
    siteName: {
      type: 'string',
      description: 'Optional. Restrict to employees assigned to this site.',
    },
    siteId: {
      type: 'string',
      description: 'Optional opaque site id from an earlier tool call.',
    },
  },
  additionalProperties: false,
};

const handler = async ({ actor, input }) => {
  const { companyId } = actor;
  let resolvedSite = null;

  if (input.siteId || input.siteName) {
    if (input.siteId) {
      if (!mongoose.Types.ObjectId.isValid(input.siteId)) {
        const { invalidInput } = require('../errors');
        throw invalidInput('That site reference is not valid');
      }
      const s = await Site.findOne({ _id: input.siteId, companyId })
        .select('_id siteLocationName')
        .lean();
      resolvedSite = s ? { id: s._id.toString(), name: s.siteLocationName } : null;
    } else {
      resolvedSite = await resolveSite(actor, input.siteName);
    }

    if (resolvedSite) {
      const assignments = await EmployeeSite.find({
        companyId,
        siteId: resolvedSite.id,
        isActive: true,
      })
        .select('employeeId')
        .lean();

      const ids = assignments.map((a) => a.employeeId.toString());

      const employees = await Employee.find({ companyId, isActive: true, _id: { $in: ids } })
        .select('_id firstName lastName position department phone')
        .sort({ lastName: 1, firstName: 1 })
        .limit(MAX_ROWS + 1)
        .lean();

      const truncated = employees.length > MAX_ROWS;
      const rows = (truncated ? employees.slice(0, MAX_ROWS) : employees).map((e) => ({
        id: e._id.toString(),
        name: `${e.firstName} ${e.lastName}`,
        position: e.position || null,
        department: e.department || null,
        phone: e.phone || null,
      }));

      return {
        data: { site: resolvedSite.name, count: rows.length, truncated, rows },
        resolvedEntities: { site: resolvedSite },
        summary: { count: rows.length, site: resolvedSite.name, truncated },
      };
    }
  }

  // No site filter — return all active employees
  const employees = await Employee.find({ companyId, isActive: true })
    .select('_id firstName lastName position department phone')
    .sort({ lastName: 1, firstName: 1 })
    .limit(MAX_ROWS + 1)
    .lean();

  const truncated = employees.length > MAX_ROWS;
  const rows = (truncated ? employees.slice(0, MAX_ROWS) : employees).map((e) => ({
    id: e._id.toString(),
    name: `${e.firstName} ${e.lastName}`,
    position: e.position || null,
    department: e.department || null,
    phone: e.phone || null,
  }));

  return {
    data: { site: null, count: rows.length, truncated, rows },
    resolvedEntities: {},
    summary: { count: rows.length, site: 'all sites', truncated },
  };
};

module.exports = {
  name: 'listEmployees',
  description:
    'List active employees in the organisation, optionally filtered to a specific site. Read-only. Returns name, position, department and contact number.',
  kind: 'read',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 8000,
  required: [],
  parameters,
  handler,
};
