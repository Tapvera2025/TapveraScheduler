const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const { requireModule } = require('../middleware/moduleAccess');
const schedulerController = require('../controllers/scheduler.controller');
const adhocController = require('../controllers/adhocShift.controller');
const validate = require('../middleware/validate');
const {
  createShiftValidation,
  createAdhocShiftValidation,
  updateShiftValidation,
  deleteShiftValidation,
  getShiftByIdValidation
} = require('../validators/shift.validator');

// All routes require authentication
router.use(auth);

// ── Site and employee lookups ────────────────────────────────────────────────
// These belong to the sites module, not the scheduler — the attendance screens
// use them too, so an organisation on attendance-without-scheduler still works.
router.get('/sites', requireModule('sites'), schedulerController.getActiveSites);
router.get('/sites/:id/employees', requireModule('sites'), schedulerController.getSiteEmployees);

// ── Adhoc shift requests ─────────────────────────────────────────────────────
// Employees ask, admins and managers decide. Gated on the adhoc module, which
// depends on the scheduler, so both are guaranteed to be on.
const adhoc = requireModule('adhoc');

// Employee self-service
router.get('/adhoc/my', adhoc, adhocController.getMyRequests);
router.post('/adhoc/my', adhoc, adhocController.requestShift);
router.put('/adhoc/my/:id/withdraw', adhoc, adhocController.withdrawMyRequest);

// Review queue
router.get('/adhoc/requests', adhoc, authorize('ADMIN', 'MANAGER'), adhocController.listRequests);
router.get('/adhoc/stats', adhoc, authorize('ADMIN', 'MANAGER'), adhocController.getStats);
router.put('/adhoc/requests/:id/approve', adhoc, authorize('ADMIN', 'MANAGER'), adhocController.approveRequest);
router.put('/adhoc/requests/:id/reject', adhoc, authorize('ADMIN', 'MANAGER'), adhocController.rejectRequest);

// ── Shifts ───────────────────────────────────────────────────────────────────
// Everything below needs the scheduler module
const scheduler = requireModule('scheduler');

router.get('/sites/:id/shifts', scheduler, schedulerController.getSiteShifts);

// Deleted shifts management (must come before /:id routes)
router.get('/shifts/deleted', scheduler, authorize('ADMIN', 'MANAGER'), schedulerController.getDeletedShifts);

// Shift CRUD routes
router.get('/shifts/:id', scheduler, ...getShiftByIdValidation, validate, schedulerController.getShiftById);
router.post('/shifts', scheduler, authorize('ADMIN', 'MANAGER'), ...createShiftValidation, validate, schedulerController.createShift);
router.post('/shifts/adhoc', scheduler, requireModule('adhoc'), authorize('ADMIN', 'MANAGER'), ...createAdhocShiftValidation, validate, schedulerController.createAdhocShift);
router.put('/shifts/:id', scheduler, authorize('ADMIN', 'MANAGER'), ...updateShiftValidation, validate, schedulerController.updateShift);
router.put('/shifts/:id/restore', scheduler, authorize('ADMIN', 'MANAGER'), schedulerController.restoreShift);
router.delete('/shifts/:id', scheduler, authorize('ADMIN', 'MANAGER'), ...deleteShiftValidation, validate, schedulerController.deleteShift);
router.delete('/shifts/:id/permanent', scheduler, authorize('ADMIN'), schedulerController.permanentDeleteShift);

module.exports = router;
