/**
 * Manual integration test for profile email change via OTP.
 *
 * Prerequisites:
 * - Backend running and reachable at BASE_URL (default http://localhost:3000)
 * - MySQL reachable from the host (defaults match docker-compose/.env.example)
 * - SQL migration for email_change_otps applied
 *
 * Run:
 *   node test/test_email_change_api.js
 */

const crypto = require('crypto');
const mysql = require('../backend/node_modules/mysql2/promise');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DB_HOST = process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 3307);
const DB_USER = process.env.TEST_DB_USER || process.env.DB_USER || 'dms_user';
const DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'dms_secure_password';
const DB_NAME = process.env.TEST_DB_NAME || process.env.DB_NAME || 'dms_db';
const TEST_PASSWORD = 'Password123!';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[EMAIL CHANGE TEST]${colors.reset} ${msg}`);
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

async function createTestDoctor(prefix) {
    const timestamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const username = `${prefix}_${timestamp}`;
    const email = `${prefix}_${timestamp}@example.com`;

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
        password: TEST_PASSWORD,
        role: 'doctor',
    });

    if (!registerResponse.ok) {
        throw new Error(`Failed to register test doctor: ${JSON.stringify(registerResponse.data)}`);
    }

    return {
        username,
        email,
        password: TEST_PASSWORD,
        token: registerResponse.data?.data?.token,
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

function intervalSql(expiresInMinutes) {
    const normalizedMinutes = Number.parseInt(expiresInMinutes, 10);
    if (!Number.isFinite(normalizedMinutes)) {
        throw new Error(`Invalid expiresInMinutes value: ${expiresInMinutes}`);
    }

    return normalizedMinutes >= 0
        ? `DATE_ADD(UTC_TIMESTAMP(), INTERVAL ${normalizedMinutes} MINUTE)`
        : `DATE_SUB(UTC_TIMESTAMP(), INTERVAL ${Math.abs(normalizedMinutes)} MINUTE)`;
}

async function setKnownEmailChangeOtp(connection, userId, newEmail, otp, expiresInMinutes) {
    await connection.execute(`DELETE FROM email_change_otps WHERE user_id = ?`, [userId]);
    await connection.execute(
        `INSERT INTO email_change_otps (user_id, new_email, token_hash, expires_at) VALUES (?, ?, ?, ${intervalSql(expiresInMinutes)})`,
        [userId, newEmail, hashOtp(otp)]
    );
}

async function setStaleOtpRows(connection, userId) {
    await connection.execute(`DELETE FROM password_reset_otps WHERE user_id = ?`, [userId]);
    await connection.execute(
        `INSERT INTO password_reset_otps (user_id, token_hash, expires_at) VALUES (?, ?, ${intervalSql(10)})`,
        [userId, hashOtp('999999')]
    );

    await connection.execute(`DELETE FROM email_verifications WHERE user_id = ?`, [userId]);
    await connection.execute(
        `INSERT INTO email_verifications (user_id, token_hash, expires_at) VALUES (?, ?, ${intervalSql(10)})`,
        [userId, hashOtp(`verify-${Date.now()}`)]
    );
}

async function countRows(connection, tableName, userId) {
    const [rows] = await connection.execute(
        `SELECT COUNT(*) AS count FROM ${tableName} WHERE user_id = ?`,
        [userId]
    );
    return Number(rows[0]?.count || 0);
}

async function getPendingEmailChange(connection, userId) {
    const [rows] = await connection.execute(
        `SELECT new_email, token_hash FROM email_change_otps WHERE user_id = ? LIMIT 1`,
        [userId]
    );
    return rows[0] ?? null;
}

async function run() {
    log('Starting profile email-change integration test...');

    let connection;

    try {
        const primaryUser = await createTestDoctor('email_change');
        const duplicateUser = await createTestDoctor('email_duplicate');
        logSuccess(`Created test doctor ${primaryUser.username}.`);

        connection = await getDbConnection();
        logSuccess(`Connected to MySQL at ${DB_HOST}:${DB_PORT}.`);

        const userId = await getUserIdByEmail(connection, primaryUser.email);
        if (!userId) {
            throw new Error('Primary test user was not found in MySQL.');
        }

        const missingEmailResponse = await apiRequest('/api/profile/email/request', 'POST', {}, primaryUser.token);
        if (missingEmailResponse.status !== 400) {
            throw new Error(`Expected 400 for missing email, got ${missingEmailResponse.status}.`);
        }
        logSuccess('Missing email/current password is rejected with 400.');

        const invalidEmailResponse = await apiRequest('/api/profile/email/request', 'POST', {
            newEmail: 'not-an-email',
            currentPassword: primaryUser.password,
        }, primaryUser.token);
        if (invalidEmailResponse.status !== 400) {
            throw new Error(`Expected invalid email to fail with 400, got ${invalidEmailResponse.status}.`);
        }
        logSuccess('Invalid email format is rejected.');

        const sameEmailResponse = await apiRequest('/api/profile/email/request', 'POST', {
            newEmail: primaryUser.email,
            currentPassword: primaryUser.password,
        }, primaryUser.token);
        if (sameEmailResponse.status !== 400) {
            throw new Error(`Expected same email to fail with 400, got ${sameEmailResponse.status}.`);
        }
        logSuccess('Same-as-current email is rejected.');

        const duplicateEmailResponse = await apiRequest('/api/profile/email/request', 'POST', {
            newEmail: duplicateUser.email,
            currentPassword: primaryUser.password,
        }, primaryUser.token);
        if (duplicateEmailResponse.status !== 409) {
            throw new Error(`Expected duplicate email to fail with 409, got ${duplicateEmailResponse.status}.`);
        }
        logSuccess('Duplicate email is rejected.');

        const wrongPasswordResponse = await apiRequest('/api/profile/email/request', 'POST', {
            newEmail: `wrong_password_${Date.now()}@example.com`,
            currentPassword: 'WrongPassword123!',
        }, primaryUser.token);
        if (wrongPasswordResponse.status !== 401) {
            throw new Error(`Expected wrong current password to fail with 401, got ${wrongPasswordResponse.status}.`);
        }
        logSuccess('Wrong current password is rejected.');

        const firstPendingEmail = `first_pending_${Date.now()}@example.com`;
        const firstRequest = await apiRequest('/api/profile/email/request', 'POST', {
            newEmail: firstPendingEmail,
            currentPassword: primaryUser.password,
        }, primaryUser.token);
        if (!firstRequest.ok || firstRequest.data?.data?.pendingEmail !== firstPendingEmail) {
            throw new Error(`First valid email-change request failed: ${JSON.stringify(firstRequest.data)}`);
        }
        const firstPending = await getPendingEmailChange(connection, userId);
        if (!firstPending || firstPending.new_email !== firstPendingEmail) {
            throw new Error('First valid request did not store a pending email-change OTP.');
        }
        logSuccess('Valid request stores a pending email-change OTP.');

        const secondPendingEmail = `second_pending_${Date.now()}@example.com`;
        const secondRequest = await apiRequest('/api/profile/email/request', 'POST', {
            newEmail: secondPendingEmail,
            currentPassword: primaryUser.password,
        }, primaryUser.token);
        if (!secondRequest.ok) {
            throw new Error(`Second valid email-change request failed: ${JSON.stringify(secondRequest.data)}`);
        }
        const pendingRowCount = await countRows(connection, 'email_change_otps', userId);
        const secondPending = await getPendingEmailChange(connection, userId);
        if (pendingRowCount !== 1 || secondPending?.new_email !== secondPendingEmail) {
            throw new Error('Second request should replace the previous pending email-change OTP.');
        }
        logSuccess('Re-requesting a code invalidates the previous pending change.');

        await setKnownEmailChangeOtp(connection, userId, secondPendingEmail, '123456', 10);
        const wrongOtpResponse = await apiRequest('/api/profile/email/confirm', 'POST', {
            otp: '000000',
        }, primaryUser.token);
        if (wrongOtpResponse.status !== 400) {
            throw new Error(`Expected wrong OTP to fail with 400, got ${wrongOtpResponse.status}.`);
        }
        logSuccess('Wrong OTP is rejected.');

        await setKnownEmailChangeOtp(connection, userId, secondPendingEmail, '111111', -1);
        const expiredOtpResponse = await apiRequest('/api/profile/email/confirm', 'POST', {
            otp: '111111',
        }, primaryUser.token);
        if (expiredOtpResponse.status !== 400) {
            throw new Error(`Expected expired OTP to fail with 400, got ${expiredOtpResponse.status}.`);
        }
        const expiredPendingCount = await countRows(connection, 'email_change_otps', userId);
        if (expiredPendingCount !== 0) {
            throw new Error('Expired email-change OTP should be cleared after a confirm attempt.');
        }
        logSuccess('Expired OTP is rejected and cleared.');

        const finalEmail = `final_email_${Date.now()}@example.com`;
        await setKnownEmailChangeOtp(connection, userId, finalEmail, '222222', 10);
        await setStaleOtpRows(connection, userId);

        const confirmSuccess = await apiRequest('/api/profile/email/confirm', 'POST', {
            otp: '222222',
        }, primaryUser.token);
        if (!confirmSuccess.ok) {
            throw new Error(`Email-change confirm failed: ${JSON.stringify(confirmSuccess.data)}`);
        }
        if (confirmSuccess.data?.data?.email !== finalEmail || confirmSuccess.data?.data?.emailVerified !== true) {
            throw new Error(`Email-change confirm returned an unexpected profile: ${JSON.stringify(confirmSuccess.data)}`);
        }
        logSuccess('Valid OTP updates the account email and keeps the account verified.');

        const profileResponse = await apiRequest('/api/profile/', 'GET', null, primaryUser.token);
        if (!profileResponse.ok || profileResponse.data?.data?.email !== finalEmail) {
            throw new Error(`Profile did not return the updated email: ${JSON.stringify(profileResponse.data)}`);
        }
        logSuccess('Profile endpoint returns the new email.');

        const emailChangeCount = await countRows(connection, 'email_change_otps', userId);
        const passwordResetCount = await countRows(connection, 'password_reset_otps', userId);
        const verificationCount = await countRows(connection, 'email_verifications', userId);
        if (emailChangeCount !== 0 || passwordResetCount !== 0 || verificationCount !== 0) {
            throw new Error('Used email-change OTP and stale auth OTP rows should all be cleared.');
        }
        logSuccess('Used email-change OTP and stale auth OTP rows are cleared.');

        log('\n==========================================');
        log(`${colors.green}EMAIL CHANGE TEST PASSED SUCCESSFULLY!${colors.reset}`);
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
