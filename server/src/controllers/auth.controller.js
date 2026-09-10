/**
 * Auth Controller
 *
 * Handles authentication operations (login, logout, token refresh)
 */

const jwt = require('jsonwebtoken');
const User = require('../models/User');
const config = require('../config');
const asyncHandler = require('../utils/asyncHandler');
const { getEnabledModules, loadCompanyAccess } = require('../middleware/moduleAccess');
const { MODULE_KEYS } = require('../config/modules');

/**
 * Generate JWT token
 */
const generateToken = (userId, companyId, role) => {
  return jwt.sign(
    { userId, companyId, role },
    config.auth.jwtSecret,
    { expiresIn: config.auth.jwtExpiresIn }
  );
};

/**
 * Which modules this user's organisation may use.
 * The master admin sits above organisations, so it gets the full set.
 */
const resolveModules = async (user) => {
  if (user.role === 'MASTER') return [...MODULE_KEYS];
  return await getEnabledModules(user.companyId);
};

/**
 * Login user
 * @route POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;

  // 1. Find user by email (include password field)
  const user = await User.findOne({ email, isActive: true }).select('+password');

  if (!user) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // 2. Check password
  const isPasswordValid = await user.comparePassword(password);

  if (!isPasswordValid) {
    return res.status(401).json({
      success: false,
      message: 'Invalid email or password'
    });
  }

  // 3. Check the organisation is allowed to sign in at all
  let enabledModules;

  if (user.role === 'MASTER') {
    enabledModules = [...MODULE_KEYS];
  } else {
    const access = await loadCompanyAccess(user.companyId);

    if (!access) {
      return res.status(403).json({
        success: false,
        message: 'Your organisation could not be found. Please contact support.'
      });
    }

    if (!access.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This organisation has been deactivated. Please contact support.'
      });
    }

    if (['suspended', 'cancelled'].includes(access.subscriptionStatus)) {
      return res.status(403).json({
        success: false,
        message: 'This organisation\'s subscription is not active. Please contact support.'
      });
    }

    enabledModules = access.enabledModules;

    // Employees can only sign in when the portal module is switched on
    if (user.role === 'USER' && !enabledModules.includes('portal')) {
      return res.status(403).json({
        success: false,
        message: 'The employee portal is not enabled for your organisation.'
      });
    }
  }

  // 4. Generate token
  const token = generateToken(user._id, user.companyId, user.role);

  // 5. Update last login
  user.lastLoginAt = new Date();
  await user.save();

  // 6. Return user data, token and the organisation's enabled modules
  res.json({
    success: true,
    data: {
      token,
      enabledModules,
      user: {
        id: user._id,
        email: user.email,
        name: user.name,
        role: user.role,
        companyId: user.companyId
      }
    }
  });
});

/**
 * Get current user (from token)
 * @route GET /api/v1/auth/me
 */
const getMe = asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId);

  if (!user) {
    return res.status(404).json({
      success: false,
      message: 'User not found'
    });
  }

  const enabledModules = await resolveModules(user);

  res.json({
    success: true,
    data: {
      id: user._id,
      email: user.email,
      name: user.name,
      role: user.role,
      companyId: user.companyId,
      lastLoginAt: user.lastLoginAt,
      enabledModules
    }
  });
});

/**
 * Logout user (client-side token removal, optional server-side cleanup)
 * @route POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  // In a stateless JWT system, logout is primarily client-side
  // But we can clear refresh token if using refresh tokens
  res.json({
    success: true,
    message: 'Logged out successfully'
  });
});

module.exports = {
  login,
  getMe,
  logout
};
