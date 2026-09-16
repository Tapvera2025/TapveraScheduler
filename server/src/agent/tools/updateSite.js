/**
 * updateSite — change the name, short name, or timezone of an existing site.
 *
 * build() is shared by prepare and commit so the world is re-validated at
 * confirmation time. The service re-checks shortName uniqueness; build checks
 * it early so the preview can explain the problem before the admin confirms.
 */

const mongoose = require('mongoose');
const Site = require('../../models/Site');
const sitesService = require('../../services/sites.service');
const { resolveSite } = require('../resolver');
const { invalidInput, notFound, conflict } = require('../errors');

const parameters = {
  type: 'object',
  properties: {
    siteName: { type: 'string', description: 'Current name or short name of the site to update.' },
    siteId: { type: 'string', description: 'Opaque site id from an earlier tool call.' },
    siteLocationName: { type: 'string', description: 'New full name for the site.' },
    shortName: { type: 'string', description: 'New short identifier for the site.' },
    timezone: { type: 'string', description: 'New IANA timezone for the site, e.g. "Australia/Sydney".' },
  },
  additionalProperties: false,
};

const resolveSiteRef = async (actor, { siteId, siteName }) => {
  if (siteId) {
    if (!mongoose.Types.ObjectId.isValid(siteId)) {
      throw invalidInput('That site reference is not valid');
    }
    const site = await Site.findOne({ _id: siteId, companyId: actor.companyId })
      .select('_id siteLocationName shortName timezone')
      .lean();
    if (!site) throw notFound('That site is not in your organisation', { entity: 'site' });
    return { id: site._id.toString(), name: site.siteLocationName, shortName: site.shortName, timezone: site.timezone };
  }
  if (siteName) return resolveSite(actor, siteName);
  throw invalidInput('Which site? Give a name or id.', { missing: ['siteName'] });
};

const build = async (actor, input) => {
  if (!input.siteName && !input.siteId) {
    throw invalidInput('Which site should I update? Give a name or id.');
  }

  const site = await resolveSiteRef(actor, input);

  const updates = {};
  if (input.siteLocationName?.trim()) updates.siteLocationName = input.siteLocationName.trim();
  if (input.shortName?.trim()) updates.shortName = input.shortName.trim();
  if (input.timezone?.trim()) updates.timezone = input.timezone.trim();

  if (Object.keys(updates).length === 0) {
    throw invalidInput('What should be changed? Provide a new name, short name, or timezone.');
  }

  if (updates.timezone) {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: updates.timezone });
    } catch {
      throw invalidInput(`"${updates.timezone}" is not a valid IANA timezone (e.g. "Australia/Sydney")`);
    }
  }

  if (updates.shortName) {
    const existing = await Site.findOne({
      shortName: updates.shortName,
      companyId: actor.companyId,
      _id: { $ne: site.id },
    }).select('_id').lean();
    if (existing) {
      throw conflict(`A site with short name "${updates.shortName}" already exists in your organisation`);
    }
  }

  return { site, updates };
};

const prepare = async ({ actor, input }) => {
  const { site, updates } = await build(actor, input);

  return {
    plan: { siteId: site.id, updates },
    preview: {
      action: 'Update site',
      site: site.name,
      changes: Object.entries(updates).map(([k, v]) => `${k}: ${v}`),
    },
    resolvedEntities: { site: { id: site.id, name: site.name } },
  };
};

const commit = async ({ actor, draft }) => {
  const { site, updates } = await build(actor, draft.input);

  await sitesService.updateSite(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    site.id,
    { ...updates }
  );

  return {
    data: { siteId: site.id, site: updates.siteLocationName || site.name, changes: Object.keys(updates) },
    summary: { updated: true, siteId: site.id, site: updates.siteLocationName || site.name },
  };
};

module.exports = {
  name: 'updateSite',
  description:
    'Update a site — rename it, change its short name, or update its timezone. This CHANGES data and must be confirmed. Give the site name or id and at least one field to update.',
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  prepare,
  commit,
};
