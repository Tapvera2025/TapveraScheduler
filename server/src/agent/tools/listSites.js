/**
 * listSites — where does this organisation work?
 *
 * The companion to listEmployees, and the answer to "what sites are available?"
 * — a question an admin asks in the middle of rostering, which until now the
 * agent could not answer at all because no tool exposed the site list.
 *
 * Active sites only by default: an inactive site cannot be rostered onto, so
 * offering it would invite a write that is then refused.
 */

const Site = require('../../models/Site');
const { fromSiteDoc, describeRadius } = require('../siteLocation');

const MAX_ROWS = 100;

const parameters = {
  type: 'object',
  properties: {
    includeInactive: {
      type: 'string',
      description: 'Pass "true" to include sites that are not active. Omit for active sites only.',
    },
  },
  additionalProperties: false,
};

const handler = async ({ actor, input }) => {
  const { companyId } = actor;
  const includeInactive = String(input.includeInactive || '').toLowerCase() === 'true';

  const query = includeInactive ? { companyId } : { companyId, status: 'ACTIVE' };

  const sites = await Site.find(query)
    .select('_id siteLocationName shortName townSuburb state timezone status location geoFenceRadius')
    .sort({ siteLocationName: 1 })
    .limit(MAX_ROWS + 1)
    .lean();

  const truncated = sites.length > MAX_ROWS;
  const rows = (truncated ? sites.slice(0, MAX_ROWS) : sites).map((s) => {
    const fence = fromSiteDoc(s);
    return {
      id: s._id.toString(),
      name: s.siteLocationName,
      shortName: s.shortName || null,
      where: [s.townSuburb, s.state].filter(Boolean).join(', ') || null,
      timezone: s.timezone || null,
      status: s.status || null,
      // Without a location, clock-in at this site is allowed from anywhere.
      // Worth surfacing: sites created through the agent before it had a map
      // all came out this way.
      geofence: fence ? describeRadius(fence.geoFenceRadius) : null,
    };
  });
  const unfenced = rows.filter((r) => !r.geofence).length;

  return {
    data: { count: rows.length, unfenced, truncated, includeInactive, rows },
    resolvedEntities: {},
    summary: { count: rows.length, unfenced, truncated, includeInactive },
  };
};

module.exports = {
  name: 'listSites',
  description:
    'List the work sites in the organisation, so a site can be named or chosen. Read-only. Active sites only unless includeInactive is "true". Returns each site name, short code, town and timezone.',
  kind: 'read',
  modules: ['sites'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 8000,
  required: [],
  parameters,
  handler,
};
