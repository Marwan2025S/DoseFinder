const mysql = require('mysql2/promise');
const { DB } = require('./constants');
const logger = require('../utils/logger');

let pool;

const initDb = async () => {
    try {
        pool = mysql.createPool({
            host: DB.HOST,
            user: DB.USER,
            password: DB.PASSWORD,
            database: DB.NAME,
            port: DB.PORT,
            waitForConnections: true,
            connectionLimit: 10,
            maxIdle: 10, // max idle connections, the default value is the same as `connectionLimit`
            idleTimeout: 60000, // idle connections timeout, in milliseconds, the default value 60000
            queueLimit: 0,
            enableKeepAlive: true,
            keepAliveInitialDelay: 0
        });

        // Test the connection
        const connection = await pool.getConnection();
        logger.info('Successfully connected to the MySQL database.');
        connection.release();
        return pool;
    } catch (error) {
        logger.error('Error connecting to the database:', error);
        throw error; // Fail fast if DB connection fails to initialize
    }
};

const getPool = () => {
    if (!pool) {
        throw new Error('Database pool has not been initialized. Call initDb() first.');
    }
    return pool;
};

// Graceful shutdown helper
const closeDb = async () => {
    if (pool) {
        logger.info('Closing database connection pool.');
        await pool.end();
    }
};

module.exports = {
    initDb,
    getPool,
    closeDb
};
