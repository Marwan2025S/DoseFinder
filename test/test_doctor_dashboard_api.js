/**
 * Manual integration test for the doctor dashboard summary endpoint.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3000 or set BASE_URL
 * - MySQL migrations for drug_issues and admin ops applied
 * - Seeded admin account from mysql/100_user_db.sql available
 */

const mysql = require('../backend/node_modules/mysql2/promise');

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEFAULT_PASSWORD = 'Password123!';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'AdminPassword1!';
const DB_HOST = process.env.TEST_DB_HOST || process.env.DB_HOST || '127.0.0.1';
const DB_PORT = Number(process.env.TEST_DB_PORT || process.env.DB_PORT || 3307);
const DB_USER = process.env.TEST_DB_USER || process.env.DB_USER || 'dms_user';
const DB_PASSWORD = process.env.TEST_DB_PASSWORD || process.env.DB_PASSWORD || 'dms_secure_password';
const DB_NAME = process.env.TEST_DB_NAME || process.env.DB_NAME || 'dms_db';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[DOCTOR DASHBOARD TEST]${colors.reset} ${msg}`);
const logSuccess = (msg) => console.log(`  ${colors.green}[OK]${colors.reset} ${msg}`);
const logError = (msg) => console.error(`  ${colors.red}[FAIL]${colors.reset} ${msg}`);

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

async function expectOk(label, requestPromise) {
    const response = await requestPromise;
    if (!response.ok) {
        throw new Error(`${label} failed with ${response.status}: ${JSON.stringify(response.data)}`);
    }
    logSuccess(label);
    return response.data;
}

async function login(identifier, password = DEFAULT_PASSWORD) {
    const data = await expectOk(`Login as ${identifier}`, apiRequest('/api/auth/login', 'POST', {
        identifier,
        password,
    }));
    return data?.data?.token;
}

async function connectDb() {
    return mysql.createConnection({
        host: DB_HOST,
        port: DB_PORT,
        user: DB_USER,
        password: DB_PASSWORD,
        database: DB_NAME,
    });
}

async function createRegisteredAccount(prefix, role = 'user') {
    const timestamp = `${Date.now()}_${Math.random().toString(16).slice(2)}`;
    const username = `${prefix}_${timestamp}`;
    const email = `${prefix}_${timestamp}@example.com`;

    const guest = await expectOk('Create guest session', apiRequest('/api/auth/new-guest', 'POST'));
    const registered = await expectOk(`Register ${role} ${username}`, apiRequest('/api/auth/register-guest', 'POST', {
        guestUsername: guest?.data?.guestUsername,
        guestAuthToken: guest?.data?.guestAuthToken,
        username,
        email,
        password: DEFAULT_PASSWORD,
        role,
    }));

    return {
        username,
        email,
        token: registered?.data?.token,
        user: registered?.data?.user,
    };
}

async function markAccountReady(connection, account, { approveDoctor = false } = {}) {
    await connection.execute(
        'UPDATE users SET is_email_verified = TRUE WHERE id = ?',
        [account.user.id]
    );

    if (approveDoctor) {
        await connection.execute(
            'UPDATE doctors SET verified_doctor = TRUE WHERE user_id = ?',
            [account.user.id]
        );
    }
}

async function getTwoDrugIds(token) {
    const response = await expectOk('Find dashboard test drugs', apiRequest('/api/drugs/search?per_page=5', 'GET', null, token));
    const ids = (response?.results || [])
        .map((drug) => drug?.drug_id || drug?.id)
        .filter(Boolean);

    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length < 2) {
        throw new Error('Expected at least two visible drugs for dashboard testing.');
    }

    return uniqueIds.slice(0, 2);
}

async function setDrugFlags(token, drugId, { visibility, reviewStatus, note }) {
    await expectOk(`Set flags for drug ${drugId}`, apiRequest(`/api/admin/drugs/${drugId}/flags`, 'PATCH', {
        visibility,
        reviewStatus,
        adminNotes: note,
        reason: 'Doctor dashboard integration test'
    }, token));
}

function listContainsDrug(items, drugId) {
    return (items || []).some((item) => Number(item.drug_id || item.id || item.drugId) === Number(drugId));
}

function listContainsIssue(items, issueId) {
    return (items || []).some((item) => Number(item.id) === Number(issueId));
}

async function run() {
    log('Starting doctor dashboard endpoint test...');
    let connection = null;
    let adminToken = null;
    let visibleReviewDrugId = null;
    let hiddenDrugId = null;

    try {
        connection = await connectDb();
        logSuccess(`Connected to MySQL at ${DB_HOST}:${DB_PORT}.`);

        adminToken = await login('admin', ADMIN_PASSWORD);
        const reportingUser = await createRegisteredAccount('dashboard_user', 'user');
        await markAccountReady(connection, reportingUser);

        const pendingDoctor = await createRegisteredAccount('dashboard_pending_doctor', 'doctor');
        await markAccountReady(connection, pendingDoctor);

        const approvedDoctor = await createRegisteredAccount('dashboard_approved_doctor', 'doctor');
        await markAccountReady(connection, approvedDoctor, { approveDoctor: true });

        const pendingResponse = await apiRequest('/api/dashboard/doctor', 'GET', null, pendingDoctor.token);
        if (pendingResponse.status !== 403) {
            throw new Error(`Pending doctor should be rejected, got ${pendingResponse.status}: ${JSON.stringify(pendingResponse.data)}`);
        }
        logSuccess('Pending doctors cannot load the doctor dashboard.');

        [visibleReviewDrugId, hiddenDrugId] = await getTwoDrugIds(adminToken);
        await setDrugFlags(adminToken, visibleReviewDrugId, {
            visibility: 'visible',
            reviewStatus: 'published',
            note: 'Reset by doctor dashboard test'
        });
        await setDrugFlags(adminToken, hiddenDrugId, {
            visibility: 'visible',
            reviewStatus: 'published',
            note: 'Reset by doctor dashboard test'
        });

        const visibleIssue = await expectOk('Create visible issue', apiRequest('/api/issues', 'POST', {
            drugId: visibleReviewDrugId,
            partKey: 'warnings',
            message: 'Visible issue for the doctor dashboard test.',
        }, reportingUser.token));
        const hiddenIssue = await expectOk('Create issue that will be hidden', apiRequest('/api/issues', 'POST', {
            drugId: hiddenDrugId,
            partKey: 'notes',
            message: 'Hidden issue for the doctor dashboard test.',
        }, reportingUser.token));

        await setDrugFlags(adminToken, visibleReviewDrugId, {
            visibility: 'visible',
            reviewStatus: 'needs_review',
            note: 'Needs review by doctor dashboard test'
        });
        await setDrugFlags(adminToken, hiddenDrugId, {
            visibility: 'hidden',
            reviewStatus: 'needs_review',
            note: 'Hidden by doctor dashboard test'
        });

        const dashboard = await expectOk('Load doctor dashboard summary', apiRequest('/api/dashboard/doctor', 'GET', null, approvedDoctor.token));
        const data = dashboard?.data || {};

        if (Number(data.metrics?.openIssues || 0) < 1) {
            throw new Error(`Expected at least one open issue, got ${JSON.stringify(data.metrics)}`);
        }
        if (Number(data.metrics?.needsReviewDrugs || 0) < 1) {
            throw new Error(`Expected at least one needs-review drug, got ${JSON.stringify(data.metrics)}`);
        }
        if (!listContainsDrug(data.needsReviewDrugs, visibleReviewDrugId)) {
            throw new Error('Visible needs-review drug is missing from the dashboard review queue.');
        }
        if (listContainsDrug(data.needsReviewDrugs, hiddenDrugId)) {
            throw new Error('Hidden drug appeared in the dashboard review queue.');
        }
        if (!listContainsIssue(data.openIssues, visibleIssue?.data?.id)) {
            throw new Error('Visible open issue is missing from the dashboard issue queue.');
        }
        if (listContainsIssue(data.openIssues, hiddenIssue?.data?.id)) {
            throw new Error('Hidden drug issue appeared in the dashboard issue queue.');
        }

        logSuccess('Dashboard includes visible work and excludes hidden work.');
        logSuccess('Doctor dashboard endpoint test completed.');
    } catch (error) {
        logError(error.message);
        process.exitCode = 1;
    } finally {
        if (adminToken && visibleReviewDrugId) {
            await setDrugFlags(adminToken, visibleReviewDrugId, {
                visibility: 'visible',
                reviewStatus: 'published',
                note: 'Restored by doctor dashboard test'
            }).catch(() => null);
        }
        if (adminToken && hiddenDrugId) {
            await setDrugFlags(adminToken, hiddenDrugId, {
                visibility: 'visible',
                reviewStatus: 'published',
                note: 'Restored by doctor dashboard test'
            }).catch(() => null);
        }
        if (connection) {
            await connection.end();
        }
    }
}

run();
