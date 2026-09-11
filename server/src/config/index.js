/**
 * Centralized Configuration System
 *
 * CRITICAL: Never access process.env directly in your code.
 * Always import and use this config module.
 *
 * Environment Loading:
 * - Uses dotenv-flow for automatic environment-specific .env file loading
 * - Loads .env.{NODE_ENV} based on NODE_ENV value
 * - Falls back to .env if environment-specific file doesn't exist
 *
 * Usage:
 *   const config = require('./config');
 *   const port = config.app.port;
 *   const dbUri = config.database.uri;
 */

const Joi = require('joi');

// Load environment variables using dotenv-flow
// This automatically loads the correct .env file based on NODE_ENV
require('dotenv-flow').config();

// Environment validation schema
const envSchema = Joi.object({
  // Application
  NODE_ENV: Joi.string()
    .valid('development', 'staging', 'production', 'test')
    .default('development'),
  APP_NAME: Joi.string().default('Tapvera Scheduler'),
  APP_PORT: Joi.number().default(5000),
  APP_URL: Joi.string().uri().required(),
  CLIENT_URL: Joi.string().uri().required(),

  // MongoDB
  MONGO_URI: Joi.string().required(),
  MONGO_DB_NAME: Joi.string().required(),

  // Authentication
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('7d'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('30d'),
  BCRYPT_SALT_ROUNDS: Joi.number().integer().min(10).max(15).default(12),

  // Timezone
  APP_TIMEZONE: Joi.string().default('Australia/Sydney'),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().default(100),

  // CORS
  CORS_ORIGIN: Joi.string().required(),

  // Logging
  LOG_LEVEL: Joi.string()
    .valid('error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly')
    .default('info'),
  LOG_FILE_PATH: Joi.string().default('./logs'),

  // Email (AWS SES)
  EMAIL_ENABLED: Joi.boolean().default(false),
  // Accepts either a bare address ("noreply@example.com") or the display-name
  // form ("Tapvera Scheduler <noreply@example.com>") that nodemailer handles.
  EMAIL_FROM: Joi.string().min(3).default('noreply@example.com'),
  EMAIL_SERVICE: Joi.string().valid('smtp', 'gmail', 'ses').default('smtp'),
  EMAIL_HOST: Joi.string().allow('').optional(),
  EMAIL_PORT: Joi.number().default(587),
  EMAIL_SECURE: Joi.boolean().default(false),
  EMAIL_USER: Joi.string().allow('').optional(),
  EMAIL_PASSWORD: Joi.string().allow('').optional(),
  AWS_REGION: Joi.string().default('ap-southeast-2'),
  AWS_SES_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_SES_SECRET_KEY: Joi.string().allow('').optional(),

  // File Upload (AWS S3)
  AWS_S3_BUCKET: Joi.string().allow('').optional(),
  AWS_S3_ACCESS_KEY: Joi.string().allow('').optional(),
  AWS_S3_SECRET_KEY: Joi.string().allow('').optional(),

  // Third-party integrations
  OPENWEATHER_API_KEY: Joi.string().allow('').optional(),
  GOOGLE_MAPS_API_KEY: Joi.string().allow('').optional(),

  // Agent planner — Google Gemini (used for BOTH planner and transcription
  // when configured). Preferred over the OpenAI-compatible chain below.
  GEMINI_API_KEY: Joi.string().allow('').optional(),
  GEMINI_BASE_URL: Joi.string().uri().default('https://generativelanguage.googleapis.com/v1beta'),
  // flash-lite has no "thinking" overhead so it fits the sub-1s planner
  // budget. The thinking-enabled 3.x models burn 80+ tokens per turn on
  // internal reasoning even for trivial calls.
  GEMINI_MODEL: Joi.string().default('gemini-3.5-flash-lite'),
  // Agent planner — primary: OpenAI GPT
  OPENAI_API_KEY: Joi.string().allow('').optional(),
  OPENAI_BASE_URL: Joi.string().uri().default('https://api.openai.com/v1'),
  OPENAI_MODEL: Joi.string().default('gpt-4o-mini'),
  // Agent planner — fallback: Grok / any OpenAI-compatible endpoint
  XAI_API_KEY: Joi.string().allow('').optional(),
  XAI_BASE_URL: Joi.string().uri().default('https://api.x.ai/v1'),
  XAI_MODEL: Joi.string().default('grok-3-mini'),
  // Provider-neutral aliases (fallback). The planner speaks plain OpenAI
  // chat-completions, so any compatible endpoint works.
  PLANNER_API_KEY: Joi.string().allow('').optional(),
  PLANNER_BASE_URL: Joi.string().uri().optional(),
  PLANNER_MODEL: Joi.string().optional(),
  PLANNER_TIMEOUT_MS: Joi.number().default(20000),
  PLANNER_MAX_OUTPUT_TOKENS: Joi.number().default(300),
  // Legacy names kept for backwards compat
  XAI_TIMEOUT_MS: Joi.number().optional(),
  XAI_MAX_OUTPUT_TOKENS: Joi.number().optional(),

  // Monitoring
  SENTRY_DSN: Joi.string().uri().allow('').optional(),
  ENABLE_APM: Joi.boolean().default(false),

  // Feature Flags
  ENABLE_API_DOCS: Joi.boolean().default(true),
  ENABLE_REQUEST_LOGGING: Joi.boolean().default(true),
  ENABLE_COMPRESSION: Joi.boolean().default(true),

  // Security
  HELMET_CSP_ENABLED: Joi.boolean().default(false),
  TRUST_PROXY: Joi.boolean().default(false),
}).unknown(true); // Allow additional env vars

// Validate environment variables
const { error, value: envVars } = envSchema.validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Export validated and structured configuration
const config = {
  env: envVars.NODE_ENV,

  app: {
    name: envVars.APP_NAME,
    port: envVars.APP_PORT,
    url: envVars.APP_URL,
    clientUrl: envVars.CLIENT_URL,
    timezone: envVars.APP_TIMEZONE,
  },

  client: {
    url: envVars.CLIENT_URL,
  },

  database: {
    uri: envVars.MONGO_URI,
    dbName: envVars.MONGO_DB_NAME,
    options: {
      // Production-grade MongoDB connection options
      maxPoolSize: envVars.NODE_ENV === 'production' ? 10 : 5,
      minPoolSize: envVars.NODE_ENV === 'production' ? 2 : 1,
      socketTimeoutMS: 45000,
      serverSelectionTimeoutMS: 5000,
      family: 4, // Use IPv4, skip trying IPv6
      // Disable autoIndex in production for performance
      autoIndex: envVars.NODE_ENV !== 'production',
    },
  },

  auth: {
    jwtSecret: envVars.JWT_SECRET,
    jwtExpiresIn: envVars.JWT_EXPIRES_IN,
    jwtRefreshExpiresIn: envVars.JWT_REFRESH_EXPIRES_IN,
    bcryptSaltRounds: envVars.BCRYPT_SALT_ROUNDS,
  },

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS,
  },

  cors: {
    origin: envVars.CORS_ORIGIN,
    credentials: true,
  },

  logging: {
    level: envVars.LOG_LEVEL,
    filePath: envVars.LOG_FILE_PATH,
  },

  email: {
    enabled: envVars.EMAIL_ENABLED,
    from: envVars.EMAIL_FROM,
    service: envVars.EMAIL_SERVICE,
    host: envVars.EMAIL_HOST,
    port: envVars.EMAIL_PORT,
    secure: envVars.EMAIL_SECURE,
    user: envVars.EMAIL_USER,
    password: envVars.EMAIL_PASSWORD,
    region: envVars.AWS_REGION,
    accessKey: envVars.AWS_SES_ACCESS_KEY,
    secretKey: envVars.AWS_SES_SECRET_KEY,
  },

  storage: {
    s3: {
      bucket: envVars.AWS_S3_BUCKET,
      accessKey: envVars.AWS_S3_ACCESS_KEY,
      secretKey: envVars.AWS_S3_SECRET_KEY,
      region: envVars.AWS_REGION,
    },
  },

  integrations: {
    openWeatherApiKey: envVars.OPENWEATHER_API_KEY,
    googleMapsApiKey: envVars.GOOGLE_MAPS_API_KEY,
  },

  // The planner's credentials live here and never leave the server.
  agent: {
    // Preferred: Google Gemini. Used for both planner and audio transcription.
    // When present, it is tried before the OpenAI-compatible chain below.
    gemini: {
      apiKey: envVars.GEMINI_API_KEY || '',
      baseUrl: envVars.GEMINI_BASE_URL,
      model: envVars.GEMINI_MODEL,
    },
    // Primary: OpenAI GPT
    primary: {
      apiKey: envVars.OPENAI_API_KEY || '',
      baseUrl: envVars.OPENAI_BASE_URL,
      model: envVars.OPENAI_MODEL,
    },
    // Fallback: Grok / any OpenAI-compatible provider
    fallback: {
      apiKey: envVars.PLANNER_API_KEY || envVars.XAI_API_KEY || '',
      baseUrl: envVars.PLANNER_BASE_URL || envVars.XAI_BASE_URL,
      model: envVars.PLANNER_MODEL || envVars.XAI_MODEL,
    },
    timeoutMs: envVars.PLANNER_TIMEOUT_MS || envVars.XAI_TIMEOUT_MS || 20000,
    maxOutputTokens: envVars.PLANNER_MAX_OUTPUT_TOKENS || envVars.XAI_MAX_OUTPUT_TOKENS || 300,
    get enabled() {
      return Boolean(
        envVars.GEMINI_API_KEY ||
          envVars.OPENAI_API_KEY ||
          envVars.PLANNER_API_KEY ||
          envVars.XAI_API_KEY
      );
    },
  },

  monitoring: {
    sentryDsn: envVars.SENTRY_DSN,
    enableAPM: envVars.ENABLE_APM,
  },

  features: {
    apiDocs: envVars.ENABLE_API_DOCS,
    requestLogging: envVars.ENABLE_REQUEST_LOGGING,
    compression: envVars.ENABLE_COMPRESSION,
  },

  security: {
    helmetCSP: envVars.HELMET_CSP_ENABLED,
    trustProxy: envVars.TRUST_PROXY,
  },

  // Helper methods
  isDevelopment: () => envVars.NODE_ENV === 'development',
  isStaging: () => envVars.NODE_ENV === 'staging',
  isProduction: () => envVars.NODE_ENV === 'production',
  isTest: () => envVars.NODE_ENV === 'test',
};

// Log configuration on startup (mask sensitive values)
if (config.isDevelopment()) {
  console.log('🔧 Configuration loaded:', {
    env: config.env,
    app: config.app,
    database: { ...config.database, uri: '[MASKED]' },
    auth: { ...config.auth, jwtSecret: '[MASKED]' },
  });
}

module.exports = config;
