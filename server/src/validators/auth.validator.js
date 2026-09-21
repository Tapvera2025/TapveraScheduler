const { body } = require('express-validator');

// Login validation
//
// Deliberately NOT normalizeEmail(). That sanitiser rewrites the address
// before the controller sees it — for Gmail and Googlemail it strips dots and
// +tags from the local part — so "archi.dutta@gmail.com" arrives as
// "archidutta@gmail.com". Accounts created outside the REST validators, which
// is every account the agent creates, are stored with the address as typed, so
// the rewritten form matched nothing and sign-in failed with "invalid email or
// password". Trim and lowercase only; the controller handles both stored forms.
const loginValidation = [
  body('email')
    .notEmpty()
    .withMessage('Email is required')
    .isEmail()
    .withMessage('Email must be valid')
    .trim()
    .toLowerCase(),

  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

module.exports = {
  loginValidation
};
