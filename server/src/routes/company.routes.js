const express = require('express');
const router = express.Router();
const { auth, authorize } = require('../middleware/auth');
const companyController = require('../controllers/company.controller');
const validate = require('../middleware/validate');
const {
  updateCompanyValidation,
  getCompanyByIdValidation
} = require('../validators/company.validator');

// All routes require authentication
router.use(auth);

// An organisation's own settings. Creating, deleting, suspending an organisation
// and choosing its modules are master-admin operations and live under /master.
router.get('/me', companyController.getMyCompany);
router.put('/me', authorize('ADMIN', 'MANAGER'), companyController.updateMyCompany);

router.get('/', companyController.getAllCompanies);
router.get('/:id', ...getCompanyByIdValidation, validate, companyController.getCompanyById);
router.put('/:id', authorize('ADMIN', 'MANAGER'), ...updateCompanyValidation, validate, companyController.updateCompany);
router.get('/:id/stats', authorize('ADMIN', 'MANAGER'), ...getCompanyByIdValidation, validate, companyController.getCompanyStats);

module.exports = router;
