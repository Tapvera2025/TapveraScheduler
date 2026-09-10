const express = require('express');
const router = express.Router();
const weatherController = require('../controllers/weather.controller');
const { auth } = require('../middleware/auth');

// All routes require authentication
router.use(auth);

// GET /api/weather/forecast - Get 5-day weather forecast
router.get('/forecast', weatherController.getForecast);

module.exports = router;
