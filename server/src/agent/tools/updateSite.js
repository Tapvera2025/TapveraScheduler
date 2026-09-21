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
const { resolveSite, siteChoices } = require('../resolver');
const { invalidInput, needsChoice, notFound, conflict } = require('../errors');
const { statedChange } = require('../statedValue');
const { fromSiteDoc, readLocation, geofenceSummary, pickerLocation } = require('../siteLocation');

const parameters = {
  type: 'object',
  properties: {
    siteName: { type: 'string', description: 'Current name or short name of the site to update.' },
    siteId: { type: 'string', description: 'Opaque site id from an earlier tool call.' },
    siteLocationName: { type: 'string', description: 'New full name for the site.' },
    shortName: { type: 'string', description: 'New short identifier for the site.' },
    timezone: { type: 'string', description: 'New IANA timezone for the site, e.g. "Australia/Sydney".' },
    address: { type: 'string', description: 'New street address.' },
    townSuburb: { type: 'string', description: 'New suburb or town.' },
    state: { type: 'string', description: 'New state or territory.' },
    postalCode: { type: 'string', description: 'New postcode or PIN code.' },
    latitude: { type: 'string', description: 'Set only by the map picker in the app. Never supply this.' },
    longitude: { type: 'string', description: 'Set only by the map picker in the app. Never supply this.' },
    geoFenceRadius: { type: 'string', description: 'New geofence radius in metres, 100 to 5000, if the admin states one.' },
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
  const { candidates, truncated } = await siteChoices(actor);
  if (!candidates.length) {
    throw invalidInput('There are no active sites to update.', { missing: ['siteName'] });
  }
  throw needsChoice('Which site should I update?', { entity: 'site', candidates, truncated });
};

const LOCATION_KEYS = ['latitude', 'longitude', 'geoFenceRadius'];
const ADDRESS_KEYS = ['address', 'townSuburb', 'state', 'postalCode'];

const build = async (actor, input) => {
  // No early guard here: resolveSiteRef asks the question, and it asks it with
  // the list of sites attached.
  const site = await resolveSiteRef(actor, input);

  // resolveSite returns just enough to identify a site, so load what the
  // geofence needs here rather than widening every caller's projection.
  const current = await Site.findOne({ _id: site.id, companyId: actor.companyId })
    .select('location geoFenceRadius address townSuburb state postalCode')
    .lean();
  const existing = fromSiteDoc(current);

  const updates = {};

  const location = readLocation(input, { existing });
  if (location) {
    updates.latitude = location.latitude;
    updates.longitude = location.longitude;
    updates.geoFenceRadius = location.geoFenceRadius;
  }

  for (const key of ADDRESS_KEYS) {
    const value = statedChange(input[key], {
      question: `What should the site's ${key === 'townSuburb' ? 'suburb or town' : key === 'postalCode' ? 'postcode' : key} be?`,
      field: key,
      nouns: [key],
    });
    if (value) updates[key] = value;
  }
  const newSiteName = statedChange(input.siteLocationName, {
    question: 'What should the site be called?',
    field: 'siteLocationName',
    nouns: ['site', 'location', 'site location', 'new name'],
  });
  if (newSiteName) updates.siteLocationName = newSiteName;

  const newShortName = statedChange(input.shortName, {
    question: 'What short code should the site use?',
    field: 'shortName',
    nouns: ['short code', 'shortname', 'code'],
  });
  if (newShortName) updates.shortName = newShortName;
  if (input.timezone?.trim()) updates.timezone = input.timezone.trim();

  if (Object.keys(updates).length === 0) {
    // "Set the geofence for North Gate" arrives here: the model cannot supply
    // coordinates, so the tool has a site and nothing to change. Offer the map
    // with the question, so setting the location is one tap away.
    throw invalidInput(
      `What should change for ${site.name}? Rename it, change its short code or timezone, or set its location on the map.`,
      { location: pickerLocation(existing, current || {}), geofence: geofenceSummary(existing) }
    );
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

  return { site, updates, existing, current };
};

const prepare = async ({ actor, input }) => {
  const { site, updates, existing, current } = await build(actor, input);

  const changedLocation = LOCATION_KEYS.some((k) => k in updates);
  const next = changedLocation
    ? { latitude: updates.latitude, longitude: updates.longitude, geoFenceRadius: updates.geoFenceRadius }
    : existing;
  const place = [updates.address ?? current?.address, updates.townSuburb ?? current?.townSuburb]
    .filter(Boolean)
    .join(', ');

  const changes = Object.entries(updates)
    .filter(([k]) => !LOCATION_KEYS.includes(k))
    .map(([k, v]) => `${k}: ${v}`);
  if (changedLocation) changes.push(`geofence: ${geofenceSummary(next, place)}`);

  return {
    plan: { siteId: site.id, updates },
    preview: {
      action: 'Update site',
      site: site.name,
      changes,
      geofence: geofenceSummary(next, place),
      location: pickerLocation(next, { ...current, ...updates }),
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
    'Update a site — rename it, change its short name, timezone or address, or set or change its location and geofence. This CHANGES data and must be confirmed. For a location or geofence request, call this with just the site name: the app shows a map for the admin to place the site, because coordinates are never supplied in conversation. A geofence radius the admin states, in metres, may be passed directly.',
  kind: 'write',
  modules: [],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 10000,
  required: [],
  parameters,
  prepare,
  commit,
};
