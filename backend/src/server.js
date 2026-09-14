// Load constants first to validate environment
const { APP } = require('./config/constants');
const app = require('./app');
const { initDb, closeDb, getPool } = require('./config/db');
const OllamaService = require('./services/ollama.service');
const logger = require('./utils/logger');

let server;

// Separate healthcheck to prevent dependency cycle in app.js
app.get('/health', async (req, res) => {
    let dbStatus = 'healthy';
    let ollamaStatus = 'healthy';
    let isDegraded = false;

    // Check DB
    try {
        const pool = getPool();
        await pool.query('SELECT 1');
    } catch (e) {
        dbStatus = 'unhealthy';
        isDegraded = true;
    }

    // Check Ollama
    try {
        await OllamaService.getTags();
    } catch (e) {
        ollamaStatus = 'unhealthy';
        isDegraded = true;
    }

    const statusCode = isDegraded ? 200 : 200; // Return 200 even if degraded for infrastructure to read the payload

    res.status(statusCode).json({
        status: isDegraded ? 'degraded' : 'healthy',
        timestamp: new Date().toISOString(),
        services: {
            database: dbStatus,
            ollama: ollamaStatus
        }
    });
});

// 404 Handler
app.use((req, res, next) => {
    res.status(404).json({
        success: false,
        error: 'Not Found',
        message: `Route ${req.method} ${req.url} not found`
    });
});

// Centralized Error Handler
app.use((err, req, res, next) => {
    logger.error(`[Express] Unhandled Error: ${err.message}`, { path: req.path, stack: err.stack });

    const status = err.status || 500;
    const errorResponse = {
        success: false,
        error: err.name || 'Internal Server Error',
        message: err.message
    };

    if (APP.ENV === 'development') {
        errorResponse.stack = err.stack;
    }

    res.status(status).json(errorResponse);
});

const startServer = async () => {
    try {
        await initDb();
        logger.info('Database connected successfully.');

        server = app.listen(APP.PORT, () => {
            logger.info(`[DMS Backend] Server is running on port ${APP.PORT} in ${APP.ENV} mode.`);
        });
    } catch (error) {
        logger.error('Failed to start server:', error.message);
        process.exit(1);
    }
};

const gracefulShutdown = async (signal) => {
    logger.info(`Received ${signal}. Shutting down gracefully...`);

    // Close Express server
    if (server) {
        server.close(async () => {
            logger.info('HTTP server closed.');

            // Close DB
            try {
                await closeDb();
                logger.info('Database connection closed.');
                process.exit(0);
            } catch (err) {
                logger.error('Error closing database connection:', err.message);
                process.exit(1);
            }
        });

        // Force close after 10s
        setTimeout(() => {
            logger.error('Could not close connections in time, forcefully shutting down');
            process.exit(1);
        }, 10000);
    } else {
        process.exit(0);
    }
};

// Handle process events
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('uncaughtException', (err) => {
    logger.error('UNCAUGHT EXCEPTION:', err.stack);
    gracefulShutdown('uncaughtException');
});

process.on('unhandledRejection', (reason, promise) => {
    logger.error('UNHANDLED REJECTION:', reason);
    gracefulShutdown('unhandledRejection');
});

startServer();
