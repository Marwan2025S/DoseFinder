const express = require('express');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { APP, LIMITS } = require('./config/constants');
const logger = require('./utils/logger');

// Import Routes
const authRoutes = require('./routes/auth.routes');
const aiRoutes = require('./routes/ai.routes');
const profileRoutes = require('./routes/profile.routes');
const drugRoutes = require('./routes/drug.routes');
const adminRoutes = require('./routes/admin.routes');
const issueRoutes = require('./routes/issue.routes');
const dashboardRoutes = require('./routes/dashboard.routes');
const contactRoutes = require('./routes/contact.routes');
const dbTableViewerRoutes = require('./routes/dbTableViewer.routes');

const app = express();

const isAllowedCorsOrigin = (origin) => {
    if (APP.CORS_ORIGINS.includes(origin)) return true;

    try {
        const { hostname, protocol } = new URL(origin);
        const normalizedHostname = hostname.toLowerCase();

        return protocol === 'https:' && APP.CORS_ORIGIN_HOST_SUFFIXES.some(suffix => (
            normalizedHostname.endsWith(suffix)
        ));
    } catch {
        return false;
    }
};

// Trust proxy if behind reverse proxy/load balancer, required for correct IP for rate limiting
app.set('trust proxy', 1);

// Custom Request Logging Middleware
app.use(logger.requestMiddleware);

// Global Middlewares
app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps or curl requests)
        if (!origin) return callback(null, true);

        if (isAllowedCorsOrigin(origin)) {
            callback(null, true);
        } else {
            callback(new Error('Not allowed by CORS'));
        }
    }
}));

app.use(express.json({ limit: APP.MAX_REQUEST_SIZE }));
app.use(express.urlencoded({ extended: true, limit: APP.MAX_REQUEST_SIZE }));

// Global Rate Limiting
const globalLimiter = rateLimit({
    windowMs: LIMITS.GLOBAL_RATE_LIMIT.WINDOW_MS,
    max: LIMITS.GLOBAL_RATE_LIMIT.MAX,
    message: {
        success: false,
        error: 'Too Many Requests',
        message: 'You have exceeded the global rate limit.'
    }
});
app.use(globalLimiter);

// Routes
app.use('/api/auth', authRoutes);
app.use('/api/ai', aiRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/drugs', drugRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/issues', issueRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/contact', contactRoutes);
app.use('/drug-db-tables', dbTableViewerRoutes);

module.exports = app;
