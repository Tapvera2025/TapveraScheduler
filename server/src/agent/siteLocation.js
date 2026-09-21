/**
 * Where a site is, and how far from it an employee may clock in.
 *
 * Geofencing only works when a site has coordinates. Without them the clock-in
 * check deliberately waves everyone through (clockInOut.service,
 * isWithinGeofence), so a site created without a location has no geofence at
 * all. The site form makes that hard to miss because the map is right there;
 * the agent created sites with no location and said nothing, which quietly
 * turned geofencing off for every site made that way.
 *
 * Coordinates are only ever taken from the map picker. A model asked for "the
 * coordinates of Connaught Place" will produce confident, plausible, slightly
 * wrong numbers, and a geofence drawn around the wrong point locks real
 * employees out at the real site. So the planner strips latitude and longitude
 * from anything the model proposes (see PICKER_ONLY_KEYS in the registry), and
 * the admin always sees the pin before a change is confirmed.
 *
 * Units follow the site form: the radius is stored in metres, and the form's
 * slider runs from 0.1 to 5 km with 0.3 km as the starting point.
 */

const { invalidInput } = require('./errors');

const DEFAULT_RADIUS_M = 300;
const MIN_RADIUS_M = 100;
const MAX_RADIUS_M = 5000;

const given = (value) => value !== undefined && value !== null && String(value).trim() !== '';

const toNumber = (value) => {
  const n = Number(String(value).trim());
  return Number.isFinite(n) ? n : NaN;
};

const describeRadius = (metres) =>
  metres >= 1000 ? `${(metres / 1000).toFixed(1).replace(/\.0$/, '')} km` : `${metres} m`;

/** The coordinates stored on a Site document, in the shape this module uses. */
const fromSiteDoc = (site) => {
  const coords = site?.location?.coordinates;
  if (!Array.isArray(coords) || coords.length !== 2) return null;
  const [longitude, latitude] = coords;
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
  return {
    latitude,
    longitude,
    geoFenceRadius: Number.isFinite(site.geoFenceRadius) ? site.geoFenceRadius : DEFAULT_RADIUS_M,
  };
};

const readRadius = (value) => {
  const r = toNumber(value);
  if (!Number.isFinite(r)) throw invalidInput('The geofence radius must be a number of metres.');
  if (r < MIN_RADIUS_M || r > MAX_RADIUS_M) {
    throw invalidInput(
      `The geofence radius must be between ${describeRadius(MIN_RADIUS_M)} and ${describeRadius(MAX_RADIUS_M)}.`
    );
  }
  return Math.round(r);
};

/**
 * Read a location from tool input.
 *
 * Returns { latitude, longitude, geoFenceRadius } or null when none was given.
 * `existing` is the site's current location, for updates: a new radius on its
 * own is a valid change when the site already has a point to draw it around.
 */
const readLocation = (input, { existing = null } = {}) => {
  const hasLat = given(input.latitude);
  const hasLng = given(input.longitude);

  if (!hasLat && !hasLng) {
    if (!given(input.geoFenceRadius)) return null;
    if (!existing) {
      throw invalidInput('A geofence needs a location first. Set the site on the map.');
    }
    return { ...existing, geoFenceRadius: readRadius(input.geoFenceRadius) };
  }

  if (hasLat !== hasLng) {
    throw invalidInput('A location needs both a latitude and a longitude. Set the site on the map.');
  }

  const latitude = toNumber(input.latitude);
  const longitude = toNumber(input.longitude);
  if (!(latitude >= -90 && latitude <= 90)) throw invalidInput('Latitude must be between -90 and 90.');
  if (!(longitude >= -180 && longitude <= 180)) throw invalidInput('Longitude must be between -180 and 180.');
  // 0,0 is in the Atlantic, and it is what a failed GPS fix reports.
  if (latitude === 0 && longitude === 0) {
    throw invalidInput('That location is not a real site. Set it on the map.');
  }

  return {
    latitude: Number(latitude.toFixed(6)),
    longitude: Number(longitude.toFixed(6)),
    geoFenceRadius: given(input.geoFenceRadius)
      ? readRadius(input.geoFenceRadius)
      : existing?.geoFenceRadius || DEFAULT_RADIUS_M,
  };
};

/** One line for the preview, so the geofence state is never implicit. */
const geofenceSummary = (location, place) => {
  if (!location) return 'Not set: employees can clock in from anywhere';
  const where = place || `${location.latitude.toFixed(5)}, ${location.longitude.toFixed(5)}`;
  return `${describeRadius(location.geoFenceRadius)} around ${where}`;
};

/**
 * What the map picker needs to open where the admin left off. Travels in the
 * preview, which the client renders; renderers skip plain objects, so this is
 * never shown as text.
 */
const pickerLocation = (location, { address, townSuburb, state, postalCode } = {}) => ({
  latitude: location?.latitude ?? null,
  longitude: location?.longitude ?? null,
  geoFenceRadius: location?.geoFenceRadius ?? DEFAULT_RADIUS_M,
  address: address || '',
  townSuburb: townSuburb || '',
  state: state || '',
  postalCode: postalCode || '',
});

module.exports = {
  DEFAULT_RADIUS_M,
  MIN_RADIUS_M,
  MAX_RADIUS_M,
  describeRadius,
  fromSiteDoc,
  readLocation,
  geofenceSummary,
  pickerLocation,
};
