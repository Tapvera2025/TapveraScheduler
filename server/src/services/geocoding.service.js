/**
 * Geocoding Service
 *
 * Proxy service for geocoding / location autocomplete using Nominatim
 * (OpenStreetMap). No API key, no billing. Response shape matches what the
 * client consumed from the previous Google-backed implementation, so the
 * frontend (LocationAutocomplete, AddSiteModal, AddEmployeeModal) needs
 * zero changes.
 *
 * Usage policy notes (https://operations.osmfoundation.org/policies/nominatim/):
 *   - Max 1 request per second per IP. Cache is already 24h so this is fine
 *     under normal use.
 *   - A descriptive User-Agent identifying the application is required.
 *   - For heavier production traffic, self-host Nominatim or move to a hosted
 *     drop-in like LocationIQ. The class boundary here makes that swap trivial.
 */

const axios = require('axios');
const NodeCache = require('node-cache');
const config = require('../config');
const logger = require('../utils/logger');

// Cache geocoding results for 24 hours
const geocodeCache = new NodeCache({ stdTTL: 86400, checkperiod: 3600 });

const USER_AGENT =
  `${config.app?.name || 'Tapvera-Scheduler'}/1.0 ` +
  `(${config.email?.from || 'contact@tapvera.io'})`;

class GeocodingService {
  constructor() {
    this.searchURL = 'https://nominatim.openstreetmap.org/search';
    this.reverseURL = 'https://nominatim.openstreetmap.org/reverse';
  }

  /**
   * Nominatim state names come through as full names ("New South Wales").
   * Australian users expect codes ("NSW"). Anywhere else we leave the string
   * as returned.
   */
  mapStateToCode(stateName) {
    if (!stateName) return '';

    const stateMap = {
      'New South Wales': 'NSW',
      'Victoria': 'VIC',
      'Queensland': 'QLD',
      'South Australia': 'SA',
      'Western Australia': 'WA',
      'Tasmania': 'TAS',
      'Northern Territory': 'NT',
      'Australian Capital Territory': 'ACT',
    };

    if (Object.values(stateMap).includes(String(stateName).toUpperCase())) {
      return String(stateName).toUpperCase();
    }

    return stateMap[stateName] || stateName;
  }

  /**
   * Nominatim's address object exposes a lot of alternative fields
   * (city vs town vs village, road vs pedestrian, etc.). Normalise those
   * to the flat shape the client already consumes.
   */
  normalizeAddress(raw = {}) {
    const streetParts = [];
    if (raw.house_number) streetParts.push(raw.house_number);
    const roadName =
      raw.road ||
      raw.pedestrian ||
      raw.footway ||
      raw.cycleway ||
      raw.path ||
      '';
    if (roadName) streetParts.push(roadName);
    const street = streetParts.join(' ').trim();

    const suburb =
      raw.suburb ||
      raw.neighbourhood ||
      raw.hamlet ||
      raw.village ||
      raw.town ||
      raw.city ||
      raw.municipality ||
      '';

    return {
      road: street,
      street,
      suburb,
      town: suburb,
      city: suburb,
      state: this.mapStateToCode(raw.state || raw.region || ''),
      postcode: raw.postcode || '',
      country: raw.country_code ? String(raw.country_code).toUpperCase() : (raw.country || ''),
    };
  }

  /**
   * Search for places by free-text query.
   *
   * @param {Object} opts
   * @param {String} opts.query        Free text (address / place name).
   * @param {String} [opts.countryCode] ISO 3166-1 alpha-2, e.g. "au".
   *                                    Nominatim expects lowercase.
   * @param {Number} [opts.limit=5]    Max predictions to return. Capped at 10.
   * @returns {Promise<Array>}
   */
  async search({ query, countryCode, limit = 5 }) {
    if (!query || String(query).trim().length < 1) {
      return [];
    }

    const trimmedQuery = String(query).trim();
    const resultLimit = Math.min(parseInt(limit, 10) || 5, 10);
    const cacheKey = `search:${trimmedQuery}:${countryCode || 'all'}:${resultLimit}`;
    const cached = geocodeCache.get(cacheKey);
    if (cached) return cached;

    try {
      const params = {
        q: trimmedQuery,
        format: 'json',
        addressdetails: 1,
        limit: resultLimit,
      };
      if (countryCode) {
        params.countrycodes = String(countryCode).toLowerCase();
      }

      const response = await axios.get(this.searchURL, {
        params,
        timeout: 10000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en',
        },
      });

      const rows = Array.isArray(response.data) ? response.data : [];

      const results = rows.map((row) => ({
        display_name: row.display_name,
        address: this.normalizeAddress(row.address || {}),
        lat: String(row.lat),
        lon: String(row.lon),
        place_id: String(row.place_id ?? row.osm_id ?? ''),
        type: row.type || 'place',
        importance: typeof row.importance === 'number' ? row.importance : 0,
      }));

      geocodeCache.set(cacheKey, results);
      return results;
    } catch (error) {
      logger.error('Nominatim search failed', {
        query: trimmedQuery,
        status: error.response?.status,
        message: error.message,
      });

      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again in a moment.');
      }
      throw new Error('Failed to fetch location suggestions. Please try again.');
    }
  }

  /**
   * Reverse geocode a coordinate pair to a structured address.
   *
   * @param {Object} opts
   * @param {Number} opts.lat
   * @param {Number} opts.lon
   * @returns {Promise<Object>}
   */
  async reverse({ lat, lon }) {
    if (!Number.isFinite(Number(lat)) || !Number.isFinite(Number(lon))) {
      throw new Error('Latitude and longitude must be valid numbers');
    }

    const cacheKey = `reverse:${Number(lat).toFixed(5)}:${Number(lon).toFixed(5)}`;
    const cached = geocodeCache.get(cacheKey);
    if (cached) return cached;

    try {
      const response = await axios.get(this.reverseURL, {
        params: {
          lat,
          lon,
          format: 'json',
          addressdetails: 1,
        },
        timeout: 10000,
        headers: {
          'User-Agent': USER_AGENT,
          'Accept-Language': 'en',
        },
      });

      const row = response.data || {};
      if (row.error) {
        // Nominatim returns {error:"Unable to geocode"} on misses (still 200)
        throw new Error(row.error);
      }

      const result = {
        display_name: row.display_name || '',
        address: this.normalizeAddress(row.address || {}),
        lat: String(row.lat ?? lat),
        lon: String(row.lon ?? lon),
        place_id: String(row.place_id ?? row.osm_id ?? ''),
      };

      geocodeCache.set(cacheKey, result);
      return result;
    } catch (error) {
      logger.error('Nominatim reverse geocode failed', {
        lat,
        lon,
        status: error.response?.status,
        message: error.message,
      });

      if (error.response?.status === 429) {
        throw new Error('Rate limit exceeded. Please try again in a moment.');
      }
      throw new Error('Failed to reverse geocode coordinates. Please try again.');
    }
  }

  /**
   * Clear all cached geocoding results.
   */
  clearCache() {
    geocodeCache.flushAll();
  }

  /**
   * Cache stats for the /geocoding/cache/stats route.
   */
  getCacheStats() {
    return geocodeCache.getStats();
  }
}

module.exports = new GeocodingService();
