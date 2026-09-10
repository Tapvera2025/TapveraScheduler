/**
 * Master Routes
 *
 * Platform administration, mounted at /api/v1/master.
 *
 * These sit outside the organisation gate: a master admin has no companyId and
 * deliberately no access to any organisation's own data.
 */

const express = require('express');
const router = express.Router();
const { auth, requireMaster } = require('../middleware/auth');
const validate = require('../middleware/validate');
const masterController = require('../controllers/master.controller');
const {
  createOrganisationValidation,
  updateOrganisationValidation,
  setModulesValidation,
  setStatusValidation,
  createAdminValidation,
  resendCredentialsValidation,
  getOrganisationValidation,
} = require('../validators/master.validator');

// Every route here is master-only
router.use(auth, requireMaster);

// Platform overview
router.get('/stats', masterController.getStats);

// The module catalogue the panel renders its switches from
router.get('/modules', masterController.getModules);

// Organisations
router.get('/organisations', masterController.listOrganisations);
router.post('/organisations', ...createOrganisationValidation, validate, masterController.createOrganisation);
router.get('/organisations/:id', ...getOrganisationValidation, validate, masterController.getOrganisation);
router.put('/organisations/:id', ...updateOrganisationValidation, validate, masterController.updateOrganisation);

// Module access
router.put('/organisations/:id/modules', ...setModulesValidation, validate, masterController.setModules);

// Suspend / reactivate
router.put('/organisations/:id/status', ...setStatusValidation, validate, masterController.setStatus);

// Organisation admins
router.post('/organisations/:id/admins', ...createAdminValidation, validate, masterController.createAdmin);
router.post('/organisations/:id/admins/:userId/resend', ...resendCredentialsValidation, validate, masterController.resendCredentials);

module.exports = router;
