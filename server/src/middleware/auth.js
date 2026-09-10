const jwt = require('jsonwebtoken');
const config = require('../config');

const auth = (req, res, next) => {
  try {
    const token = req.header('Authorization')?.replace('Bearer ', '');

    if (!token) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    const decoded = jwt.verify(token, config.auth.jwtSecret);
    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({ success: false, message: 'Invalid token' });
  }
};

const authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ success: false, message: 'Access denied' });
    }
    next();
  };
};

/**
 * Restrict a route to the platform master admin.
 *
 * MASTER sits above organisations: it manages them, and deliberately has no
 * access to any organisation's own data through the tenant routes.
 */
const requireMaster = (req, res, next) => {
  if (!req.user) {
    return res.status(401).json({ success: false, message: 'Authentication required' });
  }

  if (req.user.role !== 'MASTER') {
    return res.status(403).json({ success: false, message: 'Access denied' });
  }

  return next();
};

module.exports = { auth, authorize, requireMaster };
