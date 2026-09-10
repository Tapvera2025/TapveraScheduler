/**
 * createSite — add a place people are rostered to work.
 *
 * A site must belong to a client. The model stores that as a plain name, but
 * this resolves it against the client list anyway and uses the canonical
 * spelling, so "westfield" and "Westfield" do not become two different clients
 * as far as reporting is concerned. If no client matches, it says to add the
 * client first rather than quietly inventing one.
 */

const sitesService = require('../../services/sites.service');
const Site = require('../../models/Site');
const { resolveClient } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { invalidInput, conflict } = require('../errors');

const TIMEZONES = [
  'Australia/Perth',
  'Australia/Darwin',
  'Australia/Brisbane',
  'Australia/Adelaide',
  'Australia/Sydney',
  'Australia/Melbourne',
  'Australia/Hobart',
];

const parameters = {
  type: 'object',
  properties: {
    siteLocationName: { type: 'string', description: 'Full site name, e.g. "Westfield Bondi Junction". REQUIRED.' },
    shortName: { type: 'string', description: 'Short code or abbreviation for rosters, e.g. "WBJ". REQUIRED - ask if not given.' },
    clientName: { type: 'string', description: 'The client this site belongs to. REQUIRED - the client must already exist.' },
    address: { type: 'string', description: 'Optional street address.' },
    townSuburb: { type: 'string', description: 'Optional suburb or town.' },
    timezone: { type: 'string', description: `Optional. One of: ${TIMEZONES.join(', ')}. Defaults to the organisation timezone.` },
  },
  additionalProperties: false,
};

const build = async (actor, input) => {
  const asked = {
    siteLocationName: 'What is the site called?',
    shortName: 'What short code should the site use on rosters?',
    clientName: 'Which client is this site for?',
  };
  const missing = Object.keys(asked).filter((f) => !input[f]);
  if (missing.length) throw invalidInput(asked[missing[0]], { missing });

  const siteLocationName = input.siteLocationName.trim();
  const shortName = input.shortName.trim();

  // Must be a client that exists. Throws NOT_FOUND with a useful next step.
  const client = await resolveClient(actor, input.clientName);

  let timezone = input.timezone?.trim();
  if (timezone && !TIMEZONES.includes(timezone)) {
    throw invalidInput(`Timezone must be one of ${TIMEZONES.join(', ')}`);
  }
  if (!timezone) timezone = (await getCompanyProfile(actor.companyId)).timezone;

  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const existing = await Site.findOne({
    companyId: actor.companyId,
    $or: [
      { siteLocationName: new RegExp(`^${escape(siteLocationName)}$`, 'i') },
      { shortName: new RegExp(`^${escape(shortName)}$`, 'i') },
    ],
  })
    .select('_id siteLocationName shortName')
    .lean();

  if (existing) {
    throw conflict(
      `${existing.siteLocationName} (${existing.shortName}) already uses that name or short code`,
      { siteId: existing._id.toString() }
    );
  }

  return {
    siteLocationName,
    shortName,
    client: client.name,
    clientRef: client,
    address: input.address?.trim() || undefined,
    townSuburb: input.townSuburb?.trim() || undefined,
    timezone,
  };
};

const prepare = async ({ actor, input }) => {
  const site = await build(actor, input);
  const { clientRef, ...plan } = site;

  return {
    plan,
    preview: {
      action: 'Add site',
      site: site.siteLocationName,
      shortName: site.shortName,
      client: site.client,
      address: site.address || '—',
      townSuburb: site.townSuburb || '—',
      timezone: site.timezone,
      notes: [
        'Shift times at this site will be read in its timezone.',
        'Employees must be assigned to the site before they can be rostered there.',
      ],
    },
    resolvedEntities: { client: clientRef, site: { name: site.siteLocationName } },
  };
};

const commit = async ({ actor, draft }) => {
  const site = await build(actor, draft.input);

  const created = await sitesService.createSite(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    {
      siteLocationName: site.siteLocationName,
      shortName: site.shortName,
      client: site.client,
      address: site.address,
      townSuburb: site.townSuburb,
      timezone: site.timezone,
      status: 'ACTIVE',
    }
  );

  const id = (created?._id || created?.id || '').toString();

  return {
    data: {
      siteId: id,
      site: { id, name: site.siteLocationName },
      shortName: site.shortName,
      client: site.client,
      timezone: site.timezone,
    },
    summary: { created: true, siteId: id, site: site.siteLocationName, client: site.client },
  };
};

module.exports = {
  name: 'createSite',
  description:
    'Add a work site under an existing client. Changes data, so it is previewed and confirmed first. Site name, short code and client are all required, and the client must already exist.',
  kind: 'write',
  modules: ['sites'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: ['siteLocationName', 'shortName', 'clientName'],
  parameters,
  prepare,
  commit,
};
