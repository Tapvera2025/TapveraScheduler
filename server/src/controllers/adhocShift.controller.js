/**
 * Adhoc Shift Request Controller
 */

const adhocShiftService = require('../services/adhocShift.service');
const asyncHandler = require('../utils/asyncHandler');

const contextFrom = (req) => ({
  companyId: req.user.companyId,
  userId: req.user.userId,
  role: req.user.role,
});

// ── Employee self-service ────────────────────────────────────────────────────

/**
 * @route GET /api/v1/scheduler/adhoc/my
 */
const getMyRequests = asyncHandler(async (req, res) => {
  const data = await adhocShiftService.listMyRequests(contextFrom(req), {
    status: req.query.status,
  });
  res.json({ success: true, data });
});

/**
 * @route POST /api/v1/scheduler/adhoc/my
 */
const requestShift = asyncHandler(async (req, res) => {
  const data = await adhocShiftService.requestShift(contextFrom(req), req.body);
  res.status(201).json({ success: true, data });
});

/**
 * @route PUT /api/v1/scheduler/adhoc/my/:id/withdraw
 */
const withdrawMyRequest = asyncHandler(async (req, res) => {
  const data = await adhocShiftService.withdrawMyRequest(contextFrom(req), req.params.id);
  res.json({ success: true, data });
});

// ── Reviewer ─────────────────────────────────────────────────────────────────

/**
 * @route GET /api/v1/scheduler/adhoc/requests
 */
const listRequests = asyncHandler(async (req, res) => {
  const { status, siteId, page, limit } = req.query;
  const data = await adhocShiftService.listRequests(contextFrom(req), {
    status,
    siteId,
    page,
    limit,
  });
  res.json({ success: true, data });
});

/**
 * @route GET /api/v1/scheduler/adhoc/stats
 */
const getStats = asyncHandler(async (req, res) => {
  const data = await adhocShiftService.getStats(contextFrom(req));
  res.json({ success: true, data });
});

/**
 * @route PUT /api/v1/scheduler/adhoc/requests/:id/approve
 */
const approveRequest = asyncHandler(async (req, res) => {
  const data = await adhocShiftService.review(contextFrom(req), req.params.id, {
    approve: true,
    note: req.body.note || '',
  });
  res.json({ success: true, data });
});

/**
 * @route PUT /api/v1/scheduler/adhoc/requests/:id/reject
 */
const rejectRequest = asyncHandler(async (req, res) => {
  const data = await adhocShiftService.review(contextFrom(req), req.params.id, {
    approve: false,
    note: req.body.note || '',
  });
  res.json({ success: true, data });
});

module.exports = {
  getMyRequests,
  requestShift,
  withdrawMyRequest,
  listRequests,
  getStats,
  approveRequest,
  rejectRequest,
};
