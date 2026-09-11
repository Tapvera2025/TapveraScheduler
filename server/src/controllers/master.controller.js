/**
 * Master Controller
 *
 * Platform-level administration: organisations, their modules and their admins.
 */

const masterService = require('../services/master.service');
const asyncHandler = require('../utils/asyncHandler');

const contextFrom = (req) => ({ userId: req.user.userId, role: req.user.role });

/**
 * @route GET /api/v1/master/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const data = await masterService.getStats();
  res.json({ success: true, data });
});

/**
 * @route GET /api/v1/master/modules
 */
const getModules = asyncHandler(async (req, res) => {
  res.json({ success: true, data: masterService.getModuleCatalogue() });
});

/**
 * @route GET /api/v1/master/organisations
 */
const listOrganisations = asyncHandler(async (req, res) => {
  const { search, isActive, page, limit, sortBy, order } = req.query;
  const data = await masterService.listOrganisations({
    search,
    isActive,
    page,
    limit,
    sortBy,
    order,
  });
  res.json({ success: true, data });
});

/**
 * @route GET /api/v1/master/organisations/:id
 */
const getOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.getOrganisation(req.params.id);
  res.json({ success: true, data });
});

/**
 * @route POST /api/v1/master/organisations
 */
const createOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.createOrganisation(contextFrom(req), req.body);
  res.status(201).json({ success: true, data });
});

/**
 * @route PUT /api/v1/master/organisations/:id
 */
const updateOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.updateOrganisation(
    contextFrom(req),
    req.params.id,
    req.body
  );
  res.json({ success: true, data });
});

/**
 * @route PUT /api/v1/master/organisations/:id/modules
 */
const setModules = asyncHandler(async (req, res) => {
  const data = await masterService.setModules(
    contextFrom(req),
    req.params.id,
    req.body.modules
  );
  res.json({ success: true, data });
});

/**
 * @route PUT /api/v1/master/organisations/:id/status
 */
const setStatus = asyncHandler(async (req, res) => {
  const data = await masterService.setStatus(contextFrom(req), req.params.id, {
    isActive: req.body.isActive,
    subscriptionStatus: req.body.subscriptionStatus,
  });
  res.json({ success: true, data });
});

/**
 * @route POST /api/v1/master/organisations/:id/suspend
 */
const suspendOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.suspendOrganisation(
    contextFrom(req),
    req.params.id,
    { reason: req.body?.reason }
  );
  res.json({ success: true, data });
});

/**
 * @route POST /api/v1/master/organisations/:id/reactivate
 */
const reactivateOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.reactivateOrganisation(
    contextFrom(req),
    req.params.id
  );
  res.json({ success: true, data });
});

/**
 * @route DELETE /api/v1/master/organisations/:id
 */
const deleteOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.deleteOrganisation(
    contextFrom(req),
    req.params.id,
    { reason: req.body?.reason }
  );
  res.json({ success: true, data });
});

/**
 * @route POST /api/v1/master/organisations/:id/restore
 */
const restoreOrganisation = asyncHandler(async (req, res) => {
  const data = await masterService.restoreOrganisation(
    contextFrom(req),
    req.params.id
  );
  res.json({ success: true, data });
});

/**
 * @route POST /api/v1/master/organisations/:id/admins
 */
const createAdmin = asyncHandler(async (req, res) => {
  const data = await masterService.createAdmin(
    contextFrom(req),
    req.params.id,
    req.body
  );
  res.status(201).json({ success: true, data });
});

/**
 * @route POST /api/v1/master/organisations/:id/admins/:userId/resend
 */
const resendCredentials = asyncHandler(async (req, res) => {
  const data = await masterService.resendCredentials(
    contextFrom(req),
    req.params.id,
    req.params.userId
  );
  res.json({ success: true, data });
});

/**
 * @route PATCH /api/v1/master/organisations/:id/admins/:userId/suspend
 */
const suspendAdmin = asyncHandler(async (req, res) => {
  const data = await masterService.suspendAdmin(
    contextFrom(req),
    req.params.id,
    req.params.userId,
    req.body.isActive
  );
  res.json({ success: true, data });
});

/**
 * @route DELETE /api/v1/master/organisations/:id/admins/:userId
 */
const deleteAdmin = asyncHandler(async (req, res) => {
  const data = await masterService.deleteAdmin(
    contextFrom(req),
    req.params.id,
    req.params.userId
  );
  res.json({ success: true, data });
});

module.exports = {
  getStats,
  getModules,
  listOrganisations,
  getOrganisation,
  createOrganisation,
  updateOrganisation,
  setModules,
  setStatus,
  suspendOrganisation,
  reactivateOrganisation,
  deleteOrganisation,
  restoreOrganisation,
  createAdmin,
  resendCredentials,
  suspendAdmin,
  deleteAdmin,
};
