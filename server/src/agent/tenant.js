/**
 * Tenant profile lookups for the agent, behind a short cache.
 *
 * The agent needs the organisation's reporting timezone often and it changes
 * rarely, so this keeps the database quiet without letting a stale value
 * survive long enough to matter for a report boundary.
 */

const NodeCache = require('node-cache');
const Company = require('../models/Company');
const { DEFAULT_TIMEZONE } = require('./time');

const cache = new NodeCache({ stdTTL: 120, checkperiod: 240 });

const getCompanyProfile = async (companyId) => {
  const key = String(companyId);
  const cached = cache.get(key);
  if (cached) return cached;

  const company = await Company.findById(key).select('name timezone settings').lean();

  const profile = {
    companyId: key,
    name: company?.name || null,
    timezone: company?.timezone || DEFAULT_TIMEZONE,
  };

  cache.set(key, profile);
  return profile;
};

const invalidateCompanyProfile = (companyId) => {
  if (companyId) cache.del(String(companyId));
  else cache.flushAll();
};

module.exports = { getCompanyProfile, invalidateCompanyProfile };
