/**
 * Manual integration test for forgot-password via email OTP.
 *
 * Prerequisites:
 * - Backend running and reachable at BASE_URL (default http://localhost:3000)
 * - MySQL reachable from the host (defaults match docker-compose/.env.example)
 * - SQL migration for password_reset_otps applied
 *
 * Run:
 *   node test/test_auth_reset_api.js
 */

const crypto = require('crypto');
const mysql = require('../backend/node_modules/mysql2/promise');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DB_HOST = process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 3307);
const DB_USER = process.env.TEST_DB_USER || process.env.DB_USER || 'dms_user';
const DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'dms_secure_password';
const DB_NAME = process.env.TEST_DB_NAME || process.env.DB_NAME || 'dms_db';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[RESET TEST]${colors.reset} ${msg}`);
const logSuccess = (msg) => console.log(`  ${colors.green}✓${colors.reset} ${msg}`);
const logWarn = (msg) => console.log(`  ${colors.yellow}!${colors.reset} ${msg}`);
const logError = (msg) => console.error(`  ${colors.red}✗${colors.reset} ${msg}`);

function hashOtp(otp) {
    return crypto.createHash('sha256').update(String(otp)).digest('hex');
}

async function apiRequest(endpoint, method = 'GET', body = null, token = null) {
    const headers = {};
    if (body) headers['Content-Type'] = 'application/json';
    if (token) headers.Authorization = `Bearer ${token}`;

    const response = await fetch(`${BASE_URL}${endpoint}`, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
    });

    const data = await response.json().catch(() => null);
    return { ok: response.ok, status: response.status, data };
}

async function login(identifier, password) {
    return apiRequest('/api/auth/login', 'POST', { identifier, password });
}

async function createTestUser() {
    const timestamp = Date.now();
    const username = `reset_user_${timestamp}`;
    const email = `reset_${timestamp}@example.com`;
    const password = 'Password123!';

    const guestResponse = await apiRequest('/api/auth/new-guest', 'POST');
    if (!guestResponse.ok) {
        throw new Error(`Failed to create guest session: ${JSON.stringify(guestResponse.data)}`);
    }

    const guestUsername = guestResponse.data?.data?.guestUsername;
    const guestAuthToken = guestResponse.data?.data?.guestAuthToken;

    const registerResponse = await apiRequest('/api/auth/register-guest', 'POST', {
        guestUsername,
        guestAuthToken,
        username,
        email,
        password,
        role: 'user',
    });

    if (!registerResponse.ok) {
        throw new Error(`Failed to register test user: ${JSON.stringify(registerResponse.data)}`);
    }

    return {
        username,
        email,
        password,
    };
}

async function getDbConnection() {
    return mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
    });
}

async function getUserIdByEmail(connection, email) {
    const [rows] = await connection.execute(
        `SELECT id FROM users WHERE email = ? LIMIT 1`,
        [email]
    );
    return rows[0]?.id ?? null;
}

async function setKnownPasswordResetOtp(connection, email, otp, expiresInMinutes) {
    const userId = await getUserIdByEmail(connection, email);
    if (!userId) {
        throw new Error(`No user found for ${email}`);
    }

    const normalizedMinutes = Number.parseInt(expiresInMinutes, 10);
    if (!Number.isFinite(normalizedMinutes)) {
        throw new Error(`Invalid expiresInMinutes value: ${expiresInMinutes}`);
    }

    const intervalExpression = normalizedMinutes >= 0
        ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${normalizedMinutes} MINUTE)`
        : `DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Math.abs(normalizedMinutes)} MINUTE)`;

    await connection.execute(`DELETE FROM password_reset_otps WHERE user_id = ?`, [userId]);
    await connection.execute(
        `INSERT INTO password_reset_otps (user_id, token_hash, expires_at) VALUES (?, ?, ${intervalExpression})`,
        [userId, hashOtp(otp)]
    );

    return userId;
}

async function countRows(connection, tableName, userId) {
    const [rows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM ${tableName} WHERE user_id = ?`,
        [userId]
    );
    return Number(rows[0]?.count || 0);
}

async function run() {
    log('Starting forgot-password integration test...');

    let connection;

    try {
        const testUser = await createTestUser();
        logSuccess(`Created unverified test user ${testUser.username}.`);

        connection = await getDbConnection();
        logSuccess(`Connected to MySQL at ${DB_HOST}:${DB_PORT}.`);

        const userId = await getUserIdByEmail(connection, testUser.email);
        if (!userId) {
            throw new Error('Test user was not found in MySQL.');
        }

        const missingEmailResponse = await apiRequest('/api/auth/forgot-password/request', 'POST', {});
        if (missingEmailResponse.status !== 400) {
            throw new Error(`Expected 400 for missing email, got ${missingEmailResponse.status}.`);
        }
        logSuccess('Missing email is rejected with 400.');

        const genericResetRequest = await apiRequest('/api/auth/forgot-password/request', 'POST', {
            email: testUser.email,
        });
        if (!genericResetRequest.ok || genericResetRequest.data?.message !== 'A password reset code has been sent to your email.') {
            throw new Error(`Unexpected reset request response: ${JSON.stringify(genericResetRequest.data)}`);
        }
        logSuccess('Existing email returns a reset-code success response.');

        const nonexistentResetRequest = await apiRequest('/api/auth/forgot-password/request', 'POST', {
            email: `missing_${Date.now()}@example.com`,
        });
        if (nonexistentResetRequest.ok || nonexistentResetRequest.status !== 404 || nonexistentResetRequest.data?.message !== 'No account found for that email address') {
            throw new Error(`Non-existent email did not return the expected 404 response: ${JSON.stringify(nonexistentResetRequest.data)}`);
        }
        logSuccess('Non-existent email is rejected with 404.');

        await setKnownPasswordResetOtp(
            connection,
            testUser.email,
            '654321',
            10
        );
        const invalidOtpResponse = await apiRequest('/api/auth/forgot-password/reset', 'POST', {
            email: testUser.email,
            otp: '654320',
            newPassword: 'Different123!',
        });
        if (invalidOtpResponse.status !== 400) {
            throw new Error(`Expected invalid OTP to fail with 400, got ${invalidOtpResponse.status}.`);
        }
        logSuccess('Wrong OTP is rejected.');

        await setKnownPasswordResetOtp(
            connection,
            testUser.email,
            '111111',
            -1
        );
        const expiredOtpResponse = await apiRequest('/api/auth/forgot-password/reset', 'POST', {
            email: testUser.email,
            otp: '111111',
            newPassword: 'Different123!',
        });
        if (expiredOtpResponse.status !== 400) {
            throw new Error(`Expected expired OTP to fail with 400, got ${expiredOtpResponse.status}.`);
        }
        const expiredRowCount = await countRows(connection, 'password_reset_otps', userId);
        if (expiredRowCount !== 0) {
            throw new Error('Expired OTP should be cleared after a reset attempt.');
        }
        logSuccess('Expired OTP is rejected and cleared.');

        await setKnownPasswordResetOtp(
            connection,
            testUser.email,
            '222222',
            10
        );
        const weakPasswordResponse = await apiRequest('/api/auth/forgot-password/reset', 'POST', {
            email: testUser.email,
            otp: '222222',
            newPassword: 'weak',
        });
        if (weakPasswordResponse.status !== 400) {
            throw new Error(`Expected weak password to fail with 400, got ${weakPasswordResponse.status}.`);
        }
        logSuccess('Weak new password is rejected.');

        await setKnownPasswordResetOtp(
            connection,
            testUser.email,
            '333333',
            10
        );
        const invalidateOldOtpResponse = await apiRequest('/api/auth/forgot-password/request', 'POST', {
            email: testUser.email,
        });
        if (!invalidateOldOtpResponse.ok) {
            throw new Error(`Failed to request a replacement reset OTP: ${JSON.stringify(invalidateOldOtpResponse.data)}`);
        }
        const oldOtpReuseResponse = await apiRequest('/api/auth/forgot-password/reset', 'POST', {
            email: testUser.email,
            otp: '333333',
            newPassword: 'Replacement123!',
        });
        if (oldOtpReuseResponse.status !== 400) {
            throw new Error(`Expected old OTP to fail after re-request, got ${oldOtpReuseResponse.status}.`);
        }
        logSuccess('Re-requesting a code invalidates the previously issued OTP.');

        const nextPassword = 'Replacement123!';
        await setKnownPasswordResetOtp(
            connection,
            testUser.email,
            '444444',
            10
        );
        const resetSuccess = await apiRequest('/api/auth/forgot-password/reset', 'POST', {
            email: testUser.email,
            otp: '444444',
            newPassword: nextPassword,
        });
        if (!resetSuccess.ok) {
            throw new Error(`Password reset failed: ${JSON.stringify(resetSuccess.data)}`);
        }
        logSuccess('Password reset succeeds with a valid OTP.');

        const oldPasswordLogin = await login(testUser.username, testUser.password);
        if (oldPasswordLogin.status !== 401) {
            throw new Error(`Old password should fail after reset, got ${oldPasswordLogin.status}.`);
        }
        logSuccess('Old password no longer works.');

        const newPasswordLogin = await login(testUser.username, nextPassword);
        if (!newPasswordLogin.ok) {
            throw new Error(`New password login failed: ${JSON.stringify(newPasswordLogin.data)}`);
        }
        if (newPasswordLogin.data?.data?.user?.emailVerified !== true) {
            throw new Error('User should be marked emailVerified after a successful password reset.');
        }
        logSuccess('New password works and the account is marked email verified.');

        const emailLogin = await login(testUser.email, nextPassword);
        if (!emailLogin.ok) {
            throw new Error(`New password email login failed: ${JSON.stringify(emailLogin.data)}`);
        }
        logSuccess('New password also works when logging in by email.');

        const passwordResetRowCount = await countRows(connection, 'password_reset_otps', userId);
        if (passwordResetRowCount !== 0) {
            throw new Error('Used password reset OTP should be removed.');
        }

        const emailVerificationRowCount = await countRows(connection, 'email_verifications', userId);
        if (emailVerificationRowCount !== 0) {
            throw new Error('Pending email verification OTP should be removed after password reset.');
        }
        logSuccess('Used reset OTP and pending email verification OTP are both cleared.');

        log('\n==========================================');
        log(`${colors.green}FORGOT-PASSWORD TEST PASSED SUCCESSFULLY!${colors.reset}`);
    } catch (error) {
        log('\n==========================================');
        logError(error.message);
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end().catch(() => null);
        } else {
            logWarn('MySQL connection was not established.');
        }
    }
}

run();
