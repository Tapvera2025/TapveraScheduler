const { body, param } = require('express-validator');
const { MODULE_KEYS } = require('../config/modules');

const organisationIdRule = param('id')
  .isMongoId()
  .withMessage('Invalid organisation ID');

const createOrganisationValidation = [
  body('name')
    .trim()
    .notEmpty()
    .withMessage('Organisation name is required')
    .isLength({ max: 200 })
    .withMessage('Organisation name cannot exceed 200 characters'),
  body('email').isEmail().withMessage('A valid organisation email is required'),
  body('enabledModules')
    .optional()
    .isArray()
    .withMessage('enabledModules must be an array'),
  body('enabledModules.*')
    .optional()
    .isIn(MODULE_KEYS)
    .withMessage('Unknown module'),
  body('admin.name')
    .optional()
    .trim()
    .notEmpty()
    .withMessage('Admin name cannot be empty'),
  body('admin.email')
    .optional()
    .isEmail()
    .withMessage('A valid admin email is required'),
  body('admin.password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

const updateOrganisationValidation = [
  organisationIdRule,
  body('name').optional().trim().notEmpty().withMessage('Organisation name cannot be empty'),
  body('email').optional().isEmail().withMessage('A valid organisation email is required'),
];

const setModulesValidation = [
  organisationIdRule,
  body('modules').isArray().withMessage('modules must be an array of module keys'),
  body('modules.*').isIn(MODULE_KEYS).withMessage('Unknown module'),
];

const setStatusValidation = [
  organisationIdRule,
  body('isActive').optional().isBoolean().withMessage('isActive must be true or false'),
  body('subscriptionStatus')
    .optional()
    .isIn(['active', 'suspended', 'cancelled'])
    .withMessage('Subscription status must be active, suspended or cancelled'),
];

const createAdminValidation = [
  organisationIdRule,
  body('name').trim().notEmpty().withMessage('Admin name is required'),
  body('email').isEmail().withMessage('A valid admin email is required'),
  body('role').optional().isIn(['ADMIN', 'MANAGER']).withMessage('Role must be ADMIN or MANAGER'),
  body('password')
    .optional()
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),
];

const resendCredentialsValidation = [
  organisationIdRule,
  param('userId').isMongoId().withMessage('Invalid user ID'),
];

const adminUserIdRule = [
  organisationIdRule,
  param('userId').isMongoId().withMessage('Invalid user ID'),
];

const suspendAdminValidation = [
  ...adminUserIdRule,
  body('isActive').isBoolean().withMessage('isActive must be a boolean'),
];

const deleteAdminValidation = adminUserIdRule;

const getOrganisationValidation = [organisationIdRule];

// Optional short audit note for suspend / delete. Kept lenient — the reason
// is stored for record-keeping, not enforced business rules.
const reasonBodyRule = body('reason')
  .optional({ nullable: true, checkFalsy: true })
  .isString()
  .withMessage('Reason must be a string')
  .isLength({ max: 500 })
  .withMessage('Reason cannot exceed 500 characters');

const suspendOrganisationValidation = [organisationIdRule, reasonBodyRule];
const reactivateOrganisationValidation = [organisationIdRule];
const deleteOrganisationValidation = [organisationIdRule, reasonBodyRule];
const restoreOrganisationValidation = [organisationIdRule];

module.exports = {
  createOrganisationValidation,
  updateOrganisationValidation,
  setModulesValidation,
  setStatusValidation,
  createAdminValidation,
  resendCredentialsValidation,
  suspendAdminValidation,
  deleteAdminValidation,
  getOrganisationValidation,
  suspendOrganisationValidation,
  reactivateOrganisationValidation,
  deleteOrganisationValidation,
  restoreOrganisationValidation,
};
