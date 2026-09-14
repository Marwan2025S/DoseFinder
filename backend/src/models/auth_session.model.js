const crypto = require('crypto');
const { getPool } = require('../config/db');
const { AUTH } = require('../config/constants');

const DEFAULT_SESSION_TTL_MS = 24 * 60 * 60 * 1000;
const MAX_SAFE_STRING_LENGTH = 255;

const parseDurationMs = (value, fallbackMs = DEFAULT_SESSION_TTL_MS) => {
    if (typeof value === 'number' && Number.isFinite(value) && value > 0) {
        return value * 1000;
    }

    const text = String(value || '').trim();
    const match = text.match(/^(\d+)\s*([smhd])?$/i);
    if (!match) {
        return fallbackMs;
    }

    const amount = Number.parseInt(match[1], 10);
    if (!Number.isFinite(amount) || amount <= 0) {
        return fallbackMs;
    }

    const unit = (match[2] || 's').toLowerCase();
    const multipliers = {
        s: 1000,
        m: 60 * 1000,
        h: 60 * 60 * 1000,
        d: 24 * 60 * 60 * 1000
    };

    return amount * multipliers[unit];
};

const hmacSha256 = (value) => crypto
    .createHmac('sha256', AUTH.HASH_SECRET)
    .update(String(value || ''))
    .digest('hex');

const safeString = (value, maxLength = MAX_SAFE_STRING_LENGTH) => {
    if (value === null || value === undefined) {
        return null;
    }

    const text = String(value).trim();
    if (!text) {
        return null;
    }

    return text.length > maxLength ? text.slice(0, maxLength) : text;
};

const safePositiveInt = (value) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
};

const getRequestIp = (req) => {
    const forwardedFor = req.headers?.['x-forwarded-for'];
    if (typeof forwardedFor === 'string' && forwardedFor.trim()) {
        return forwardedFor.split(',')[0].trim();
    }

    return safeString(req.ip || req.socket?.remoteAddress, 120);
};

const stripHeaderQuotes = (value) => safeString(value, 120)?.replace(/^"|"$/g, '') || null;

const parseMajorVersion = (value) => {
    const parsed = Number.parseInt(String(value || '').split('.')[0], 10);
    return Number.isFinite(parsed) ? parsed : null;
};

const normalizeWindowsVersionFromUa = (ntVersion) => {
    const version = safeString(ntVersion, 120);
    if (!version) {
        return null;
    }

    if (version === '10.0') {
        return null;
    }

    return {
        '6.3': '8.1',
        '6.2': '8',
        '6.1': '7',
        '6.0': 'Vista',
        '5.2': 'XP',
        '5.1': 'XP'
    }[version] || version;
};

const getWindowsVersionFromClientHints = (clientHints = {}) => {
    if (String(clientHints.platform || '').toLowerCase() !== 'windows') {
        return null;
    }

    const majorVersion = parseMajorVersion(clientHints.platformVersion);
    if (majorVersion === null || majorVersion <= 0) {
        return null;
    }

    return majorVersion >= 13 ? '11' : '10';
};

const normalizeOsSummary = (osMatch, clientHints = {}) => {
    if (!osMatch) {
        return { osName: 'Unknown OS', osVersion: null };
    }

    const osVersion = osMatch.match?.[1]?.replace(/_/g, '.') || null;
    if (osMatch.name === 'Windows') {
        return {
            osName: 'Windows',
            osVersion: getWindowsVersionFromClientHints(clientHints) || normalizeWindowsVersionFromUa(osVersion)
        };
    }

    return {
        osName: osMatch.name,
        osVersion
    };
};

const getRequestClientHints = (req) => ({
    platform: stripHeaderQuotes(req.get?.('sec-ch-ua-platform') || req.headers?.['sec-ch-ua-platform']),
    platformVersion: stripHeaderQuotes(req.get?.('sec-ch-ua-platform-version') || req.headers?.['sec-ch-ua-platform-version'])
});

const getPayloadClientHints = (summary = {}) => ({
    platform: safeString(
        summary.uaPlatform
            ?? summary.clientHints?.platform
            ?? summary.userAgentData?.platform
            ?? summary.platform,
        120
    ),
    platformVersion: safeString(
        summary.uaPlatformVersion
            ?? summary.clientHints?.platformVersion
            ?? summary.userAgentData?.platformVersion,
        120
    )
});

const normalizeIncomingOsVersion = (osName, osVersion, clientHints = {}) => {
    const version = safeString(osVersion, 120);
    if (osName === 'Windows') {
        return getWindowsVersionFromClientHints(clientHints) || normalizeWindowsVersionFromUa(version);
    }

    return version;
};

const parseUserAgentSummary = (userAgent = '', clientHints = {}) => {
    const text = String(userAgent);
    const browserMatchers = [
        ['Edge', /\bEdg\/([\d.]+)/],
        ['Chrome', /\bChrome\/([\d.]+)/],
        ['Firefox', /\bFirefox\/([\d.]+)/],
        ['Safari', /\bVersion\/([\d.]+).*Safari\//],
        ['Mobile Safari', /\bMobile\/.*Safari\//]
    ];
    const osMatchers = [
        ['Windows', /Windows NT ([\d.]+)/],
        ['macOS', /Mac OS X ([\d_]+)/],
        ['iOS', /(?:iPhone|iPad).*OS ([\d_]+)/],
        ['Android', /Android ([\d.]+)/],
        ['Linux', /\bLinux\b/]
    ];

    const browserMatch = browserMatchers
        .map(([name, pattern]) => ({ name, match: text.match(pattern) }))
        .find((entry) => entry.match);
    const osMatch = osMatchers
        .map(([name, pattern]) => ({ name, match: text.match(pattern) }))
        .find((entry) => entry.match);
    const osSummary = normalizeOsSummary(osMatch, clientHints);

    return {
        browserName: browserMatch?.name || 'Unknown browser',
        browserVersion: browserMatch?.match?.[1]?.replace(/_/g, '.') || null,
        ...osSummary
    };
};

const normalizeFingerprintSummary = (payload, req) => {
    const summary = payload && typeof payload.summary === 'object' && !Array.isArray(payload.summary)
        ? payload.summary
        : {};
    const payloadClientHints = getPayloadClientHints(summary);
    const requestClientHints = getRequestClientHints(req);
    const clientHints = {
        platform: payloadClientHints.platform || requestClientHints.platform,
        platformVersion: payloadClientHints.platformVersion || requestClientHints.platformVersion
    };
    const userAgentSummary = parseUserAgentSummary(
        req.get?.('user-agent') || req.headers?.['user-agent'] || '',
        clientHints
    );

    const osName = safeString(summary.osName ?? summary.os?.name ?? userAgentSummary.osName, 120);
    const osVersion = safeString(
        normalizeIncomingOsVersion(osName, summary.osVersion ?? summary.os?.version, clientHints)
            ?? userAgentSummary.osVersion,
        120
    );

    return {
        browserName: safeString(summary.browserName ?? summary.browser?.name ?? userAgentSummary.browserName, 120),
        browserVersion: safeString(summary.browserVersion ?? summary.browser?.version ?? userAgentSummary.browserVersion, 120),
        osName,
        osVersion,
        screenResolution: safeString(summary.screenResolution, 80),
        timezone: safeString(summary.timezone, 120),
        language: safeString(summary.language, 80),
        hardwareConcurrency: safePositiveInt(summary.hardwareConcurrency),
        gpuVendor: safeString(summary.gpuVendor ?? summary.gpu?.vendor, 255),
        gpuRenderer: safeString(summary.gpuRenderer ?? summary.gpu?.renderer, 255)
    };
};

const normalizeDeviceFingerprint = (req, payload) => {
    const userAgent = safeString(req.get?.('user-agent') || req.headers?.['user-agent'], 1000);
    const acceptLanguage = safeString(req.get?.('accept-language') || req.headers?.['accept-language'], 255);
    const ip = getRequestIp(req);
    const summary = normalizeFingerprintSummary(payload, req);
    const version = safeString(payload?.version, 32) || 'server-fallback';
    const clientHash = safeString(payload?.fingerprintHash, 512);
    const deviceKey = clientHash
        ? `client:${version}:${clientHash}`
        : `server:${userAgent || ''}:${acceptLanguage || ''}:${ip || ''}`;

    return {
        deviceHash: hmacSha256(deviceKey),
        fingerprintVersion: version,
        ipHash: ip ? hmacSha256(ip) : null,
        userAgentHash: userAgent ? hmacSha256(userAgent) : null,
        summary
    };
};

class AuthSessionModel {
    static generateSessionId() {
        return crypto.randomBytes(32).toString('base64url');
    }

    static getSessionExpiryDate() {
        return new Date(Date.now() + parseDurationMs(AUTH.JWT_EXPIRES_IN));
    }

    static hashSessionId(sessionId) {
        return hmacSha256(`session:${sessionId}`);
    }

    static async upsertDevice({ userId, req, deviceFingerprint }) {
        const pool = getPool();
        const normalized = normalizeDeviceFingerprint(req, deviceFingerprint);

        const [existingRows] = await pool.execute(
            `SELECT id FROM user_devices WHERE user_id = ? AND device_hash = ? LIMIT 1`,
            [userId, normalized.deviceHash]
        );

        if (existingRows[0]) {
            await pool.execute(
                `
                    UPDATE user_devices
                    SET
                        fingerprint_version = ?,
                        browser_name = ?,
                        browser_version = ?,
                        os_name = ?,
                        os_version = ?,
                        screen_resolution = ?,
                        timezone = ?,
                        language = ?,
                        hardware_concurrency = ?,
                        gpu_vendor = ?,
                        gpu_renderer = ?,
                        last_ip_hash = ?,
                        last_user_agent_hash = ?,
                        last_seen_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                `,
                [
                    normalized.fingerprintVersion,
                    normalized.summary.browserName,
                    normalized.summary.browserVersion,
                    normalized.summary.osName,
                    normalized.summary.osVersion,
                    normalized.summary.screenResolution,
                    normalized.summary.timezone,
                    normalized.summary.language,
                    normalized.summary.hardwareConcurrency,
                    normalized.summary.gpuVendor,
                    normalized.summary.gpuRenderer,
                    normalized.ipHash,
                    normalized.userAgentHash,
                    existingRows[0].id
                ]
            );

            return {
                id: existingRows[0].id,
                summary: normalized.summary,
                isNewDevice: false,
                isFirstDevice: false,
                ipHash: normalized.ipHash,
                userAgentHash: normalized.userAgentHash
            };
        }

        const [countRows] = await pool.execute(
            `SELECT COUNT(*) AS device_count FROM user_devices WHERE user_id = ?`,
            [userId]
        );
        const isFirstDevice = Number(countRows[0]?.device_count || 0) === 0;

        try {
            const [result] = await pool.execute(
                `
                    INSERT INTO user_devices (
                        user_id,
                        device_hash,
                        fingerprint_version,
                        browser_name,
                        browser_version,
                        os_name,
                        os_version,
                        screen_resolution,
                        timezone,
                        language,
                        hardware_concurrency,
                        gpu_vendor,
                        gpu_renderer,
                        first_ip_hash,
                        last_ip_hash,
                        first_user_agent_hash,
                        last_user_agent_hash
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `,
                [
                    userId,
                    normalized.deviceHash,
                    normalized.fingerprintVersion,
                    normalized.summary.browserName,
                    normalized.summary.browserVersion,
                    normalized.summary.osName,
                    normalized.summary.osVersion,
                    normalized.summary.screenResolution,
                    normalized.summary.timezone,
                    normalized.summary.language,
                    normalized.summary.hardwareConcurrency,
                    normalized.summary.gpuVendor,
                    normalized.summary.gpuRenderer,
                    normalized.ipHash,
                    normalized.ipHash,
                    normalized.userAgentHash,
                    normalized.userAgentHash
                ]
            );

            return {
                id: result.insertId,
                summary: normalized.summary,
                isNewDevice: true,
                isFirstDevice,
                ipHash: normalized.ipHash,
                userAgentHash: normalized.userAgentHash
            };
        } catch (error) {
            if (error.code !== 'ER_DUP_ENTRY') {
                throw error;
            }

            return this.upsertDevice({ userId, req, deviceFingerprint });
        }
    }

    static async createSession({ userId, userDeviceId, sessionId, req, expiresAt }) {
        const pool = getPool();
        const ip = getRequestIp(req);
        const userAgent = safeString(req.get?.('user-agent') || req.headers?.['user-agent'], 1000);

        const [result] = await pool.execute(
            `
                INSERT INTO auth_sessions (
                    user_id,
                    user_device_id,
                    session_hash,
                    ip_hash,
                    user_agent_hash,
                    expires_at
                )
                VALUES (?, ?, ?, ?, ?, ?)
            `,
            [
                userId,
                userDeviceId || null,
                this.hashSessionId(sessionId),
                ip ? hmacSha256(ip) : null,
                userAgent ? hmacSha256(userAgent) : null,
                expiresAt
            ]
        );

        return { id: result.insertId };
    }

    static async recordLoginEvent({ userId, userDeviceId, authSessionId, eventType, newDevice, req }) {
        const pool = getPool();
        const ip = getRequestIp(req);
        const userAgent = safeString(req.get?.('user-agent') || req.headers?.['user-agent'], 1000);

        await pool.execute(
            `
                INSERT INTO login_events (
                    user_id,
                    user_device_id,
                    auth_session_id,
                    event_type,
                    new_device,
                    ip_hash,
                    user_agent_hash
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                userId,
                userDeviceId || null,
                authSessionId || null,
                eventType || 'login_success',
                Boolean(newDevice),
                ip ? hmacSha256(ip) : null,
                userAgent ? hmacSha256(userAgent) : null
            ]
        );
    }

    static async createAuthenticatedSession({ userId, req, deviceFingerprint, eventType }) {
        const sessionId = this.generateSessionId();
        const device = await this.upsertDevice({ userId, req, deviceFingerprint });
        const session = await this.createSession({
            userId,
            userDeviceId: device.id,
            sessionId,
            req,
            expiresAt: this.getSessionExpiryDate()
        });
        const newDeviceDetected = device.isNewDevice && !device.isFirstDevice;

        await this.recordLoginEvent({
            userId,
            userDeviceId: device.id,
            authSessionId: session.id,
            eventType,
            newDevice: newDeviceDetected,
            req
        });

        return {
            sessionId,
            session,
            device,
            newDeviceDetected
        };
    }

    static async findActiveSession(sessionId, userId) {
        if (!sessionId || !userId) {
            return null;
        }

        const pool = getPool();
        const [rows] = await pool.execute(
            `
                SELECT
                    id,
                    user_id,
                    user_device_id,
                    expires_at,
                    revoked_at,
                    last_seen_at
                FROM auth_sessions
                WHERE session_hash = ? AND user_id = ?
                LIMIT 1
            `,
            [this.hashSessionId(sessionId), userId]
        );
        const session = rows[0] || null;
        if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) {
            return null;
        }

        return session;
    }

    static async touchSession(session) {
        if (!session?.id) {
            return false;
        }

        const lastSeenMs = new Date(session.last_seen_at || 0).getTime();
        if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs < AUTH.SESSION_TOUCH_INTERVAL_MS) {
            return false;
        }

        const pool = getPool();
        await pool.execute(
            `UPDATE auth_sessions SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ? AND revoked_at IS NULL`,
            [session.id]
        );

        if (session.user_device_id) {
            await pool.execute(
                `UPDATE user_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE id = ?`,
                [session.user_device_id]
            );
        }

        return true;
    }

    static async revokeSession(sessionId, userId) {
        if (!sessionId || !userId) {
            return false;
        }

        const pool = getPool();
        const [result] = await pool.execute(
            `
                UPDATE auth_sessions
                SET revoked_at = COALESCE(revoked_at, CURRENT_TIMESTAMP)
                WHERE session_hash = ? AND user_id = ?
            `,
            [this.hashSessionId(sessionId), userId]
        );

        return result.affectedRows > 0;
    }
}

module.exports = AuthSessionModel;
