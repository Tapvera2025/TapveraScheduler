/**
 * Geocoding Routes
 *
 * Routes for geocoding and location search
 */

const express = require('express');
const router = express.Router();
const geocodingService = require('../services/geocoding.service');
const { auth, authorize } = require('../middleware/auth');

/**
 * @route   GET /api/geocoding/search
 * @desc    Search for locations by query
 * @access  Private
 * @query   {string} q - Search query (required, min 3 chars)
 * @query   {string} countryCode - Country code filter (optional, e.g., 'au')
 * @query   {number} limit - Maximum results (optional, default: 5, max: 10)
 */
router.get('/search', auth, async (req, res) => {
  try {
    const { q: query, countryCode, limit = 5 } = req.query;

    // Validation
    if (!query || query.trim().length < 1) {
      return res.status(400).json({
        success: false,
        message: 'Query must be at least 1 character',
      });
    }

    // Limit the maximum results
    const resultLimit = Math.min(parseInt(limit) || 5, 10);

    const results = await geocodingService.search({
      query: query.trim(),
      countryCode,
      limit: resultLimit,
    });

    res.json({
      success: true,
      data: results,
      count: results.length,
    });
  } catch (error) {
    console.error('Geocoding search error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to search locations',
    });
  }
});

/**
 * @route   GET /api/geocoding/reverse
 * @desc    Reverse geocode coordinates to address
 * @access  Private
 * @query   {number} lat - Latitude (required)
 * @query   {number} lon - Longitude (required)
 */
router.get('/reverse', auth, async (req, res) => {
  try {
    const { lat, lon } = req.query;

    // Validation
    if (!lat || !lon) {
      return res.status(400).json({
        success: false,
        message: 'Latitude and longitude are required',
      });
    }

    const result = await geocodingService.reverse({
      lat: parseFloat(lat),
      lon: parseFloat(lon),
    });

    res.json({
      success: true,
      data: result,
    });
  } catch (error) {
    console.error('Reverse geocoding error:', error);
    res.status(500).json({
      success: false,
      message: error.message || 'Failed to reverse geocode coordinates',
    });
  }
});

/**
 * @route   POST /api/geocoding/cache/clear
 * @desc    Clear geocoding cache
 * @access  Private (ADMIN only)
 */
router.post('/cache/clear', auth, authorize('ADMIN'), async (req, res) => {
  try {
    geocodingService.clearCache();

    res.json({
      success: true,
      message: 'Geocoding cache cleared successfully',
    });
  } catch (error) {
    console.error('Cache clear error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to clear cache',
    });
  }
});

/**
 * @route   GET /api/geocoding/cache/stats
 * @desc    Get cache statistics
 * @access  Private (ADMIN only)
 */
router.get('/cache/stats', auth, authorize('ADMIN'), async (req, res) => {
  try {
    const stats = geocodingService.getCacheStats();

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    console.error('Cache stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to get cache statistics',
    });
  }
});

module.exports = router;
