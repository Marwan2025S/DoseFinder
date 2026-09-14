/**
 * Custom logger with colored console output plus persistent system log files.
 */

const fs = require('fs');
const path = require('path');

const LOG_DIRECTORY = path.resolve(process.env.LOG_DIR || path.join(__dirname, '../../logs'));
const LOG_FILES = Object.freeze({
    system: 'system.log',
    errors: 'system-error.log',
    requests: 'requests.log',
});
const DEBUG_CONSOLE_ENABLED = process.env.NODE_ENV === 'development' || process.env.DEBUG === 'true';
const DEBUG_FILE_ENABLED = process.env.LOG_DEBUG_TO_FILE !== 'false';
const FILE_LOGGING_ENABLED = process.env.LOG_TO_FILE !== 'false';
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|secret|token|password|pass|api[-_]?key|fingerprint|session)/i;

// Simple ANSI color codes for terminal output
const colors = {
    reset: '\x1b[0m',
    info: '\x1b[36m', // Cyan
    warn: '\x1b[33m', // Yellow
    error: '\x1b[31m', // Red
    debug: '\x1b[90m', // Gray
};

const fileStreams = new Map();
let logDirectoryReady = false;
let fileLoggingFailureNotified = false;

const notifyFileLoggingFailure = (error, filePath) => {
    if (fileLoggingFailureNotified) {
        return;
    }

    fileLoggingFailureNotified = true;
    const failureMessage = `[logger] Failed to write log file${filePath ? ` (${filePath})` : ''}: ${error.message}\n`;
    try {
        process.stderr.write(failureMessage);
    } catch (stderrError) {
        // Swallow secondary failures to avoid crashing during logging.
    }
};

const ensureLogDirectory = () => {
    if (!FILE_LOGGING_ENABLED || logDirectoryReady) {
        return FILE_LOGGING_ENABLED;
    }

    try {
        fs.mkdirSync(LOG_DIRECTORY, { recursive: true });
        logDirectoryReady = true;
        return true;
    } catch (error) {
        notifyFileLoggingFailure(error, LOG_DIRECTORY);
        return false;
    }
};

const getLogStream = (fileName) => {
    if (!ensureLogDirectory()) {
        return null;
    }

    const existingStream = fileStreams.get(fileName);
    if (existingStream) {
        return existingStream;
    }

    const filePath = path.join(LOG_DIRECTORY, fileName);

    try {
        const stream = fs.createWriteStream(filePath, { flags: 'a', encoding: 'utf8' });
        stream.on('error', (error) => {
            fileStreams.delete(fileName);
            notifyFileLoggingFailure(error, filePath);
        });
        fileStreams.set(fileName, stream);
        return stream;
    } catch (error) {
        notifyFileLoggingFailure(error, filePath);
        return null;
    }
};

const writeLineToFile = (fileName, line) => {
    if (!FILE_LOGGING_ENABLED) {
        return;
    }

    const stream = getLogStream(fileName);
    if (!stream) {
        return;
    }

    try {
        stream.write(`${line}\n`);
    } catch (error) {
        notifyFileLoggingFailure(error, path.join(LOG_DIRECTORY, fileName));
    }
};

const redactSensitiveData = (value, key = '') => {
    if (value instanceof Error) {
        return {
            name: value.name,
            message: value.message,
            stack: value.stack,
            status: value.status,
            data: redactSensitiveData(value.data, 'data'),
        };
    }

    if (Array.isArray(value)) {
        return value.map((item) => redactSensitiveData(item, key));
    }

    if (value && typeof value === 'object') {
        return Object.entries(value).reduce((result, [entryKey, entryValue]) => {
            if (SENSITIVE_KEY_PATTERN.test(entryKey)) {
                result[entryKey] = '[Redacted]';
                return result;
            }

            result[entryKey] = redactSensitiveData(entryValue, entryKey);
            return result;
        }, {});
    }

    if (typeof value === 'string') {
        return value.length > 4000
            ? `${value.slice(0, 4000)}... [truncated ${value.length - 4000} chars]`
            : value;
    }

    if (SENSITIVE_KEY_PATTERN.test(key)) {
        return '[Redacted]';
    }

    return value;
};

const safeSerialize = (value) => {
    const redactedValue = redactSensitiveData(value);
    if (redactedValue === null || redactedValue === undefined) {
        return redactedValue;
    }

    if (typeof redactedValue !== 'object') {
        return redactedValue;
    }

    const seen = new WeakSet();

    return JSON.parse(JSON.stringify(redactedValue, (key, currentValue) => {
        if (typeof currentValue === 'bigint') {
            return currentValue.toString();
        }

        if (typeof currentValue === 'object' && currentValue !== null) {
            if (seen.has(currentValue)) {
                return '[Circular]';
            }
            seen.add(currentValue);
        }
        return currentValue;
    }));
};

const formatMessage = (level, message, meta) => {
    const timestamp = new Date().toISOString();
    let logString = `[${timestamp}] [${level}] ${message}`;

    if (meta !== null && meta !== undefined) {
        if (typeof meta === 'object') {
            try {
                logString += ` ${JSON.stringify(safeSerialize(meta))}`;
            } catch (error) {
                logString += ' [Unserializable metadata]';
            }
        } else {
            logString += ` ${meta}`;
        }
    }

    return logString;
};

const createRequestId = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

const summarizeBody = (body) => {
    if (body === undefined || body === null) {
        return undefined;
    }

    if (typeof body === 'string') {
        return body.length > 500
            ? `${body.slice(0, 500)}... [truncated ${body.length - 500} chars]`
            : body;
    }

    if (Buffer.isBuffer(body)) {
        return `[Buffer ${body.length} bytes]`;
    }

    return body;
};

const normalizeContentLength = (value) => {
    if (value === undefined || value === null || value === '') {
        return null;
    }

    const parsed = Number.parseInt(String(value), 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const emitConsoleLog = (level, line) => {
    const color = colors[level.toLowerCase()] || colors.info;
    const payload = `${color}${line}${colors.reset}`;

    if (level === 'ERROR') {
        console.error(payload);
        return;
    }

    if (level === 'WARN') {
        console.warn(payload);
        return;
    }

    if (level === 'DEBUG') {
        console.debug(payload);
        return;
    }

    console.log(payload);
};

const writeLog = (level, message, meta = null, options = {}) => {
    const line = formatMessage(level, message, meta);
    const consoleEnabled = options.consoleEnabled ?? (level !== 'DEBUG' || DEBUG_CONSOLE_ENABLED);
    const fileEnabled = options.fileEnabled ?? (FILE_LOGGING_ENABLED && (level !== 'DEBUG' || DEBUG_FILE_ENABLED));

    if (consoleEnabled) {
        emitConsoleLog(level, line);
    }

    if (!fileEnabled) {
        return;
    }

    writeLineToFile(LOG_FILES.system, line);

    if (options.requestLog) {
        writeLineToFile(LOG_FILES.requests, line);
    }

    if (level === 'ERROR') {
        writeLineToFile(LOG_FILES.errors, line);
    }
};

const logger = {
    info: (message, meta = null) => {
        writeLog('INFO', message, meta);
    },
    warn: (message, meta = null) => {
        writeLog('WARN', message, meta);
    },
    error: (message, meta = null) => {
        writeLog('ERROR', message, meta);
    },
    debug: (message, meta = null) => {
        writeLog('DEBUG', message, meta);
    },

    // Express middleware to log incoming requests with a dedicated request log file.
    requestMiddleware: (req, res, next) => {
        const start = Date.now();
        const requestId = createRequestId();
        const route = req.originalUrl || req.url;

        req.requestId = requestId;
        res.setHeader('X-Request-Id', requestId);

        res.on('finish', () => {
            const duration = Date.now() - start;
            const message = `${req.method} ${route} ${res.statusCode} - ${duration}ms`;
            const meta = {
                requestId,
                method: req.method,
                route,
                statusCode: res.statusCode,
                durationMs: duration,
                ip: req.ip,
                userId: req.user?.id || null,
                userAgent: req.get('user-agent') || null,
                referrer: req.get('referer') || null,
                requestBody: summarizeBody(req.body),
                query: req.query,
                params: req.params,
                responseBytes: normalizeContentLength(res.getHeader('content-length')),
            };

            if (res.statusCode >= 500) {
                writeLog('ERROR', message, meta, { requestLog: true });
            } else if (res.statusCode >= 400) {
                writeLog('WARN', message, meta, { requestLog: true });
            } else {
                writeLog('INFO', message, meta, { requestLog: true });
            }
        });

        res.on('close', () => {
            if (res.writableEnded) {
                return;
            }

            const duration = Date.now() - start;
            writeLog('WARN', `${req.method} ${route} aborted - ${duration}ms`, {
                requestId,
                method: req.method,
                route,
                durationMs: duration,
                ip: req.ip,
                userId: req.user?.id || null,
            }, { requestLog: true });
        });

        next();
    },
};

module.exports = logger;
