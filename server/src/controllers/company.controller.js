/**
 * Company Controller (an organisation's own settings)
 *
 * Creating, deleting and suspending organisations, and deciding their modules,
 * are master-admin operations — see master.controller.js.
 */

const companyService = require('../services/company.service');
const asyncHandler = require('../utils/asyncHandler');

const contextFrom = (req) => ({
  companyId: req.user.companyId,
  userId: req.user.userId,
  role: req.user.role,
});

/**
 * The caller's own organisation, in list shape
 * @route GET /api/v1/companies
 */
const getAllCompanies = asyncHandler(async (req, res) => {
  const result = await companyService.getAllCompanies(contextFrom(req));
  res.json({ success: true, data: result });
});

/**
 * The caller's own organisation
 * @route GET /api/v1/companies/me
 */
const getMyCompany = asyncHandler(async (req, res) => {
  const company = await companyService.getMyCompany(contextFrom(req));
  res.json({ success: true, data: company });
});

/**
 * Update the caller's own organisation
 * @route PUT /api/v1/companies/me
 */
const updateMyCompany = asyncHandler(async (req, res) => {
  const company = await companyService.updateMyCompany(contextFrom(req), req.body);
  res.json({
    success: true,
    data: company,
    message: 'Settings saved',
  });
});

/**
 * Get single company by ID (own organisation only)
 * @route GET /api/v1/companies/:id
 */
const getCompanyById = asyncHandler(async (req, res) => {
  const company = await companyService.getCompanyById(contextFrom(req), req.params.id);
  res.json({ success: true, data: company });
});

/**
 * Update a company (own organisation only)
 * @route PUT /api/v1/companies/:id
 */
const updateCompany = asyncHandler(async (req, res) => {
  const company = await companyService.updateCompany(
    contextFrom(req),
    req.params.id,
    req.body
  );

  res.json({
    success: true,
    data: company,
    message: 'Company updated successfully',
  });
});

/**
 * Get company statistics (own organisation only)
 * @route GET /api/v1/companies/:id/stats
 */
const getCompanyStats = asyncHandler(async (req, res) => {
  const stats = await companyService.getCompanyStats(contextFrom(req), req.params.id);
  res.json({ success: true, data: stats });
});

module.exports = {
  getAllCompanies,
  getMyCompany,
  updateMyCompany,
  getCompanyById,
  updateCompany,
  getCompanyStats,
};
