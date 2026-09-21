/**
 * createSite — add a place people are rostered to work.
 *
 * Only the site name is required. Short code and client are both optional; the
 * tool asks a yes/no question for each before either is collected, so an admin
 * who only knows the site's name is one confirmation away from saving. When a
 * client is chosen it still resolves against the tenant's client list so
 * "westfield" and "Westfield" don't become two different clients in reporting.
 * A picked client arrives as clientId; that field exists alongside clientName.
 */

const sitesService = require('../../services/sites.service');
const Site = require('../../models/Site');
const mongoose = require('mongoose');
const Client = require('../../models/Client');
const { resolveClient, clientChoices } = require('../resolver');
const { getCompanyProfile } = require('../tenant');
const { invalidInput, needsChoice, notFound, conflict } = require('../errors');
const { requireStated } = require('../statedValue');
const { readLocation, geofenceSummary, pickerLocation } = require('../siteLocation');

// Read from the model rather than copied, so the agent accepts exactly what the
// site form accepts. The copy that lived here had drifted: it lacked
// Asia/Kolkata, so a site in India could not be created through the agent.
const TIMEZONES = Site.schema.path('timezone').enumValues;

const parameters = {
  type: 'object',
  properties: {
    siteLocationName: { type: 'string', description: 'Full site name, e.g. "Westfield Bondi Junction". REQUIRED. Omit this field entirely if the admin has not said it — never guess and never send a placeholder.' },
    shortName: { type: 'string', description: 'Optional short code or abbreviation for rosters, e.g. "WBJ". Only send this if the admin has stated a short code, or after the admin has said yes to the short-name question. Never guess.' },
    shortNameChoiceId: { type: 'string', description: 'Set by the yes/no picker after the admin decides whether to enter a short code ("yes" or "no"). Never guess this.' },
    shortNameChoiceName: { type: 'string', description: 'Cleared by the picker; ignore.' },
    clientName: { type: 'string', description: 'Optional client this site belongs to. Only send this if the admin has stated a client, or after the admin has said yes to the client question. Client must already exist. Never guess.' },
    clientId: { type: 'string', description: 'Opaque client id from an earlier tool call or an admin choosing from a list. Never invent one.' },
    clientChoiceId: { type: 'string', description: 'Set by the yes/no picker after the admin decides whether to attach a client ("yes" or "no"). Never guess this.' },
    clientChoiceName: { type: 'string', description: 'Cleared by the picker; ignore.' },
    address: { type: 'string', description: 'Optional street address.' },
    townSuburb: { type: 'string', description: 'Optional suburb or town.' },
    state: { type: 'string', description: 'Optional state or territory.' },
    postalCode: { type: 'string', description: 'Optional postcode or PIN code.' },
    latitude: { type: 'string', description: 'Set only by the map picker in the app. Never supply this.' },
    longitude: { type: 'string', description: 'Set only by the map picker in the app. Never supply this.' },
    geoFenceRadius: { type: 'string', description: 'Optional geofence radius in metres, 100 to 5000, if the admin states one. Clock-in is allowed within this distance of the site.' },
    timezone: { type: 'string', description: `Optional. One of: ${TIMEZONES.join(', ')}. Defaults to the organisation timezone.` },
  },
  additionalProperties: false,
};

// Yes/no button pairs, offered through the same choice picker the admin uses
// to disambiguate real entities. The picker treats these ids as opaque values,
// so 'yes' and 'no' come back on the next call as shortNameChoiceId / clientChoiceId.
const YES_NO = [
  { id: 'yes', name: 'Yes' },
  { id: 'no', name: 'No, skip' },
];

const resolveClientRef = async (actor, { clientId, clientName }) => {
  if (clientId) {
    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      throw invalidInput('That client reference is not valid');
    }
    const client = await Client.findOne({ _id: clientId, companyId: actor.companyId })
      .select('_id clientName')
      .lean();
    if (!client) throw notFound('That client is not in your organisation', { entity: 'client' });
    return { id: client._id.toString(), name: client.clientName };
  }
  if (clientName) return resolveClient(actor, clientName);

  const { candidates, truncated } = await clientChoices(actor);
  if (!candidates.length) {
    // Nothing to choose from — treat this as if the admin skipped, so the site
    // can still be created. The client can be attached later from the UI.
    return null;
  }
  throw needsChoice('Which client does this site belong to?', {
    entity: 'client',
    candidates,
    truncated,
  });
};

const build = async (actor, input) => {
  // Site name is the only value the admin must supply. Short code and client
  // are gated behind their own yes/no question, so this asks in that order
  // and returns as soon as an answer is missing.
  if (!input.siteLocationName) {
    throw invalidInput('What is the site called?', { missing: ['siteLocationName'] });
  }

  // Validated with the other cheap checks, before any database work.
  const location = readLocation(input);

  const siteLocationName = requireStated(input.siteLocationName, {
    question: 'What is the site called?',
    field: 'siteLocationName',
    nouns: ['site', 'location', 'site location'],
  });

  // Short code — ask yes/no first, then the value if yes. An admin who
  // volunteered a short code up-front skips the question altogether.
  let shortName;
  if (input.shortName) {
    shortName = requireStated(input.shortName, {
      question: 'What short code should the site use on rosters?',
      field: 'shortName',
      nouns: ['short code', 'shortname', 'code'],
    });
  } else if (!input.shortNameChoiceId) {
    throw needsChoice('Do you want to add a short code for this site?', {
      entity: 'shortNameChoice',
      candidates: YES_NO,
    });
  } else if (input.shortNameChoiceId === 'yes') {
    throw invalidInput('What short code should the site use on rosters?', {
      missing: ['shortName'],
    });
  }
  // shortNameChoiceId === 'no' → leave shortName undefined.

  // Client — same shape as the short-code question. If the admin already gave
  // a client name or id, use it directly and skip the yes/no gate.
  let client;
  if (input.clientId || input.clientName) {
    client = await resolveClientRef(actor, input);
  } else if (!input.clientChoiceId) {
    throw needsChoice('Do you want to attach this site to a client?', {
      entity: 'clientChoice',
      candidates: YES_NO,
    });
  } else if (input.clientChoiceId === 'yes') {
    client = await resolveClientRef(actor, input);
  }
  // clientChoiceId === 'no' → leave client undefined.

  let timezone = input.timezone?.trim();
  if (timezone && !TIMEZONES.includes(timezone)) {
    throw invalidInput(`Timezone must be one of ${TIMEZONES.join(', ')}`);
  }
  if (!timezone) timezone = (await getCompanyProfile(actor.companyId)).timezone;

  const escape = (v) => v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Only include shortName in the duplicate check when one was actually given —
  // otherwise every site without a short code would collide with every other.
  const duplicateChecks = [
    { siteLocationName: new RegExp(`^${escape(siteLocationName)}$`, 'i') },
  ];
  if (shortName) {
    duplicateChecks.push({ shortName: new RegExp(`^${escape(shortName)}$`, 'i') });
  }
  const existing = await Site.findOne({
    companyId: actor.companyId,
    $or: duplicateChecks,
  })
    .select('_id siteLocationName shortName')
    .lean();

  if (existing) {
    throw conflict(
      `${existing.siteLocationName} (${existing.shortName || '—'}) already uses that name or short code`,
      { siteId: existing._id.toString() }
    );
  }

  return {
    siteLocationName,
    shortName,
    client: client?.name,
    clientRef: client,
    address: input.address?.trim() || undefined,
    townSuburb: input.townSuburb?.trim() || undefined,
    state: input.state?.trim() || undefined,
    postalCode: input.postalCode?.trim() || undefined,
    location,
    timezone,
  };
};

const prepare = async ({ actor, input }) => {
  const site = await build(actor, input);
  const { clientRef, ...plan } = site;

  const place = [site.address, site.townSuburb].filter(Boolean).join(', ');
  const notes = [
    'Shift times at this site will be read in its timezone.',
    'Employees must be assigned to the site before they can be rostered there.',
  ];
  if (!site.location) {
    notes.unshift('No geofence yet. Set the location on the map so clock-in is only allowed at the site.');
  }

  const resolvedEntities = { site: { name: site.siteLocationName } };
  if (clientRef) resolvedEntities.client = clientRef;

  return {
    plan,
    preview: {
      action: 'Add site',
      site: site.siteLocationName,
      shortName: site.shortName || '—',
      client: site.client || '—',
      address: site.address || '—',
      townSuburb: site.townSuburb || '—',
      timezone: site.timezone,
      geofence: geofenceSummary(site.location, place),
      location: pickerLocation(site.location, site),
      notes,
    },
    resolvedEntities,
  };
};

const commit = async ({ actor, draft }) => {
  const site = await build(actor, draft.input);

  // Empty optional fields are stripped before saving so mongoose stores
  // `undefined` (or nothing) rather than empty strings that clutter the DB.
  const payload = {
    siteLocationName: site.siteLocationName,
    address: site.address,
    townSuburb: site.townSuburb,
    state: site.state,
    postalCode: site.postalCode,
    timezone: site.timezone,
    status: 'ACTIVE',
  };
  if (site.shortName) payload.shortName = site.shortName;
  if (site.client) payload.client = site.client;
  if (site.location) {
    payload.latitude = site.location.latitude;
    payload.longitude = site.location.longitude;
    payload.geoFenceRadius = site.location.geoFenceRadius;
  }

  const created = await sitesService.createSite(
    { companyId: actor.companyId, userId: actor.userId, role: actor.role },
    payload
  );

  const id = (created?._id || created?.id || '').toString();

  return {
    data: {
      siteId: id,
      site: { id, name: site.siteLocationName },
      shortName: site.shortName,
      client: site.client,
      timezone: site.timezone,
      geofence: geofenceSummary(site.location, [site.address, site.townSuburb].filter(Boolean).join(', ')),
      geofenced: Boolean(site.location),
    },
    summary: {
      created: true,
      siteId: id,
      site: site.siteLocationName,
      client: site.client,
      geofenced: Boolean(site.location),
    },
  };
};

module.exports = {
  name: 'createSite',
  description:
    'Add a work site. Changes data, so it is previewed and confirmed first. Only the site name is required — the tool asks a yes/no question before collecting a short code and again before attaching a client. Never guess a short code or a client name; wait for the admin. The site\'s location and geofence are set on a map in the preview, never supplied in conversation; a geofence radius the admin states, in metres, may be passed.',
  kind: 'write',
  modules: ['sites'],
  roles: ['ADMIN', 'MANAGER'],
  timeoutMs: 12000,
  required: ['siteLocationName'],
  parameters,
  prepare,
  commit,
};
