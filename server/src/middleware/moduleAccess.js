/**
 * Module Access Middleware
 *
 * The JWT carries the user's role and companyId and lasts for days, so it
 * cannot be trusted to say what an organisation is currently allowed to do.
 * These guards look the organisation up on each request instead, behind a
 * short-lived cache so the cost stays negligible.
 *
 * - requireActiveCompany: the organisation exists, is active and not suspended
 * - requireModule('x'):   module 'x' is switched on for the organisation
 *
 * Call invalidateCompanyAccess() after changing an organisation so the change
 * takes effect immediately rather than when the cache expires.
 */

const NodeCache = require('node-cache');
const Company = require('../models/Company');
const { MODULE_KEYS, MODULES, normaliseModules } = require('../config/modules');
const logger = require('../utils/logger');

// Short TTL: long enough to keep the database quiet, short enough that a
// suspension or module change lands almost immediately even without a flush.
const accessCache = new NodeCache({ stdTTL: 60, checkperiod: 120 });

const SUSPENDED_SUBSCRIPTION_STATUSES = ['suspended', 'cancelled'];

/**
 * Load an organisation's access state, from cache where possible.
 * @returns {Promise<Object|null>} null when the organisation does not exist
 */
const loadCompanyAccess = async (companyId) => {
  if (!companyId) return null;

  const cacheKey = String(companyId);
  const cached = accessCache.get(cacheKey);
  if (cached) return cached;

  let company;
  try {
    company = await Company.findById(cacheKey)
      .select('name isActive subscription.status enabledModules')
      .lean();
  } catch (error) {
    logger.error('Could not load organisation access', {
      companyId: cacheKey,
      error: error.message,
    });
    return null;
  }

  if (!company) return null;

  const configured = normaliseModules(company.enabledModules);

  const access = {
    companyId: cacheKey,
    name: company.name,
    isActive: company.isActive !== false,
    subscriptionStatus: company.subscription?.status || 'active',
    // Records created before modules existed have nothing set — treat those as
    // having everything, so enabling this feature never locks anyone out.
    enabledModules: configured.length > 0 ? configured : [...MODULE_KEYS],
  };

  accessCache.set(cacheKey, access);
  return access;
};

/**
 * Drop a cached organisation (or all of them) after a change.
 */
const invalidateCompanyAccess = (companyId) => {
  if (companyId) {
    accessCache.del(String(companyId));
  } else {
    accessCache.flushAll();
  }
};

/**
 * The modules an organisation may currently use.
 */
const getEnabledModules = async (companyId) => {
  const access = await loadCompanyAccess(companyId);
  return access ? access.enabledModules : [];
};

/**
 * Require a live, non-suspended organisation.
 * Runs after `auth`, so req.user is already populated.
 */
const requireActiveCompany = async (req, res, next) => {
  try {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required' });
    }

    // The master admin manages organisations but has no access to their data.
    // Its own routes are mounted before this gate, so reaching here is a
    // request for a tenant route and is refused.
    if (req.user.role === 'MASTER') {
      return res.status(403).json({
        success: false,
        message: 'Master admins manage organisations and cannot access organisation data',
      });
    }

    if (!req.user.companyId) {
      return res.status(403).json({
        success: false,
        message: 'This account is not linked to an organisation',
      });
    }

    const access = await loadCompanyAccess(req.user.companyId);

    if (!access) {
      logger.warn('Request for an organisation that no longer exists', {
        companyId: req.user.companyId,
        userId: req.user.userId,
      });
      return res.status(403).json({
        success: false,
        message: 'Organisation not found',
      });
    }

    if (!access.isActive) {
      return res.status(403).json({
        success: false,
        message: 'This organisation has been deactivated. Please contact support.',
      });
    }

    if (SUSPENDED_SUBSCRIPTION_STATUSES.includes(access.subscriptionStatus)) {
      return res.status(403).json({
        success: false,
        message: 'This organisation\'s subscription is not active. Please contact support.',
      });
    }

    req.company = access;
    return next();
  } catch (error) {
    return next(error);
  }
};

/**
 * Require every named module to be enabled for the caller's organisation.
 *
 * Usage:
 *   router.use(requireModule('sites'));
 *   router.post('/adhoc', requireModule('adhoc'), handler);
 */
const requireModule = (...moduleKeys) => {
  const required = moduleKeys.flat().filter(Boolean);

  // Fail loudly at startup rather than silently letting everything through
  required.forEach((key) => {
    if (!MODULES[key]) {
      throw new Error(`requireModule() was given an unknown module: "${key}"`);
    }
  });

  return async (req, res, next) => {
    try {
      if (!req.user) {
        return res.status(401).json({ success: false, message: 'Authentication required' });
      }

      // requireActiveCompany already turns master admins away from tenant
      // routes; this is only here so requireModule stays safe to reuse.
      if (req.user.role === 'MASTER') return next();

      const access = req.company || (await loadCompanyAccess(req.user.companyId));

      if (!access) {
        return res.status(403).json({ success: false, message: 'Organisation not found' });
      }

      const missing = required.filter((key) => !access.enabledModules.includes(key));

      if (missing.length > 0) {
        return res.status(403).json({
          success: false,
          message: `${MODULES[missing[0]].label} is not enabled for your organisation.`,
          modules: missing,
        });
      }

      return next();
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = {
  loadCompanyAccess,
  invalidateCompanyAccess,
  getEnabledModules,
  requireActiveCompany,
  requireModule,
};
