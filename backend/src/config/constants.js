require('dotenv').config();

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const parseBoolean = (value, fallback = false) => {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return fallback;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on', 'ssl', 'tls'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;

  return fallback;
};

const normalizeCorsOrigin = (origin) => {
  const trimmed = origin.trim();
  if (!trimmed) return '';

  try {
    return new URL(trimmed).origin;
  } catch {
    return trimmed.replace(/\/+$/, '');
  }
};

const requiredEnvVars = [
  'JWT_SECRET',
  'DB_HOST',
  'DB_USER',
  'DB_PASSWORD',
  'DB_NAME',
  'DRUG_API_URL'
];

const missingVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
const hasOllamaBaseUrl = Boolean(process.env.OLLAMA_BASE_URL);
const hasOllamaHostAndPort = Boolean(process.env.OLLAMA_HOST && process.env.OLLAMA_PORT);

if (!hasOllamaBaseUrl && !hasOllamaHostAndPort) {
  missingVars.push('OLLAMA_BASE_URL or both OLLAMA_HOST and OLLAMA_PORT');
}

if (missingVars.length > 0) {
  console.error(`ERROR: Missing required environment variables: ${missingVars.join(', ')}`);
  process.exit(1);
}

if (process.env.JWT_SECRET.length < 32) {
  console.error('ERROR: JWT_SECRET must be at least 32 characters long for security purposes.');
  process.exit(1);
}

const defaultCorsOrigins = ['http://localhost:3000', 'http://localhost:8080', 'http://localhost:8081'];
const defaultCorsOriginHostSuffixes = ['.trycloudflare.com', '.shares.zrok.io'];
const configuredCorsOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map(normalizeCorsOrigin).filter(Boolean)
  : [];

const CONSTANTS = {
  APP: {
    PORT: process.env.PORT || 3000,
    ENV: process.env.NODE_ENV || 'development',
    CORS_ORIGINS: Array.from(new Set([
      ...configuredCorsOrigins,
      ...(process.env.NODE_ENV === 'production' ? [] : defaultCorsOrigins)
    ])),
    CORS_ORIGIN_HOST_SUFFIXES: process.env.NODE_ENV === 'production'
      ? []
      : defaultCorsOriginHostSuffixes,
    MAX_REQUEST_SIZE: process.env.MAX_REQUEST_SIZE || '1mb'
  },
  DB: {
    HOST: process.env.DB_HOST,
    USER: process.env.DB_USER,
    PASSWORD: process.env.DB_PASSWORD,
    NAME: process.env.DB_NAME,
    PORT: process.env.DB_PORT || 3306
  },
  AUTH: {
    JWT_SECRET: process.env.JWT_SECRET,
    HASH_SECRET: process.env.AUTH_HASH_SECRET || process.env.JWT_SECRET,
    JWT_EXPIRES_IN: '24h',
    SESSION_TOUCH_INTERVAL_MS: parsePositiveInt(process.env.SESSION_TOUCH_INTERVAL_MS, 5 * 60 * 1000),
    EMAIL_VERIFICATION_TOKEN_TTL_MINUTES: Number(process.env.EMAIL_VERIFICATION_TOKEN_TTL_MINUTES || 30),
    PASSWORD_RESET_OTP_TTL_MINUTES: Number(process.env.PASSWORD_RESET_OTP_TTL_MINUTES || 15),
    RESEND_OTP_COOLDOWN_SECONDS: Number(process.env.RESEND_OTP_COOLDOWN_SECONDS || 60),
    PASSWORD_POLICY: {
      MIN_LENGTH: 12,
      // Requires at least one uppercase, one lowercase, one number, and one special character
      REGEX: /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/
    }
  },
  GOOGLE: {
    // OAuth 2.0 Web Client ID used to verify Google ID tokens (the same value is
    // exposed to the frontend as VITE_GOOGLE_CLIENT_ID). Blank disables Google sign-in.
    CLIENT_ID: process.env.GOOGLE_CLIENT_ID || ''
  },
  EMAIL: {
    FROM: process.env.EMAIL_FROM || 'no-reply@dms.local',
    CONTACT: process.env.CONTACT_EMAIL || 'info@dosefinder.com',
    VERIFY_BASE_URL: process.env.EMAIL_VERIFY_BASE_URL || 'http://localhost:8080/verify-email',
    SMTP_HOST: process.env.SMTP_HOST || 'smtp.gmail.com',
    SMTP_PORT: Number(process.env.SMTP_PORT || 587),
    SMTP_USER: process.env.SMTP_USER || '',
    SMTP_PASS: process.env.SMTP_PASS || '',
    SMTP_SECURE: parseBoolean(process.env.SMTP_SECURE, Number(process.env.SMTP_PORT || 587) === 465)
  },
  OLLAMA: {
    BASE_URL: process.env.OLLAMA_BASE_URL || '',
    HOST: process.env.OLLAMA_HOST,
    PORT: process.env.OLLAMA_PORT,
    API_KEY: process.env.OLLAMA_API_KEY || '',
    DEFAULT_MODEL: process.env.OLLAMA_MODEL || 'llama3.2',
    TIMEOUT_MS: 360000 // 6 minutes
  },
  DRUG_API: {
    URL: process.env.DRUG_API_URL
  },
  LIMITS: {
    TITLE_MAX_LENGTH: 200,
    CHAT_SEARCH_MAX_LENGTH: 200,
    CHAT_CONTEXT_MAX_MESSAGES: 20,
    MESSAGE_MAX_LENGTH: 10000,
    PAGINATION_DEFAULT_LIMIT: 20,
    PAGINATION_MAX_LIMIT: 100,
    GLOBAL_RATE_LIMIT: {
      WINDOW_MS: parsePositiveInt(process.env.GLOBAL_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      MAX: parsePositiveInt(process.env.GLOBAL_RATE_LIMIT_MAX, 1000)
    },
    AUTH_RATE_LIMIT: {
      WINDOW_MS: parsePositiveInt(process.env.AUTH_RATE_LIMIT_WINDOW_MS, 15 * 60 * 1000),
      MAX: parsePositiveInt(process.env.AUTH_RATE_LIMIT_MAX, 50)
    }
  }
};

module.exports = CONSTANTS;
