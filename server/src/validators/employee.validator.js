const { body, param, query } = require('express-validator');

// Create employee validation
const createEmployeeValidation = [
  body('firstName')
    .notEmpty()
    .withMessage('First name is required')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),

  body('lastName')
    .notEmpty()
    .withMessage('Last name is required')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),

  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Email must be valid')
    .normalizeEmail(),

  body('phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^[\d\s\-+()]{6,20}$/)
    .withMessage('Phone can contain digits, spaces and + - ( ) only'),

  body('position')
    .notEmpty()
    .withMessage('Position is required')
    .trim(),

  body('department')
    .optional({ nullable: true, checkFalsy: true })
    .trim(),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  // Optional. Supplying one creates a portal login for this employee; leaving it
  // blank creates an employee record with no login at all.
  body('password')
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),

  body('address').optional({ nullable: true, checkFalsy: true }).trim(),
  body('townSuburb').optional({ nullable: true, checkFalsy: true }).trim(),
  body('state').optional({ nullable: true, checkFalsy: true }).trim(),
  body('postalCode').optional({ nullable: true, checkFalsy: true }).trim(),

  body('emergencyContact.name').optional({ nullable: true, checkFalsy: true }).trim(),
  body('emergencyContact.relationship').optional({ nullable: true, checkFalsy: true }).trim(),
  body('emergencyContact.phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^[\d\s\-+()]{6,20}$/)
    .withMessage('Emergency phone can contain digits, spaces and + - ( ) only')
];

// Update employee validation
const updateEmployeeValidation = [
  param('id')
    .notEmpty()
    .withMessage('Employee ID is required'),

  body('firstName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('First name must be between 2 and 50 characters'),

  body('lastName')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Last name must be between 2 and 50 characters'),

  body('email')
    .optional()
    .isEmail()
    .withMessage('Email must be valid')
    .normalizeEmail(),

  body('phone')
    .optional({ nullable: true })
    .isMobilePhone()
    .withMessage('Phone must be a valid mobile number'),

  body('position')
    .optional()
    .trim(),

  body('department')
    .optional({ nullable: true })
    .trim(),

  body('isActive')
    .optional()
    .isBoolean()
    .withMessage('isActive must be a boolean'),

  // Optional. Supplying one creates a portal login for this employee; leaving it
  // blank creates an employee record with no login at all.
  body('password')
    .optional({ nullable: true, checkFalsy: true })
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters'),

  body('address').optional({ nullable: true, checkFalsy: true }).trim(),
  body('townSuburb').optional({ nullable: true, checkFalsy: true }).trim(),
  body('state').optional({ nullable: true, checkFalsy: true }).trim(),
  body('postalCode').optional({ nullable: true, checkFalsy: true }).trim(),

  body('emergencyContact.name').optional({ nullable: true, checkFalsy: true }).trim(),
  body('emergencyContact.relationship').optional({ nullable: true, checkFalsy: true }).trim(),
  body('emergencyContact.phone')
    .optional({ nullable: true, checkFalsy: true })
    .trim()
    .matches(/^[\d\s\-+()]{6,20}$/)
    .withMessage('Emergency phone can contain digits, spaces and + - ( ) only')
];

// Delete employee validation
const deleteEmployeeValidation = [
  param('id')
    .notEmpty()
    .withMessage('Employee ID is required')
];

// Get employee by ID validation
const getEmployeeByIdValidation = [
  param('id')
    .notEmpty()
    .withMessage('Employee ID is required')
];

module.exports = {
  createEmployeeValidation,
  updateEmployeeValidation,
  deleteEmployeeValidation,
  getEmployeeByIdValidation
};
