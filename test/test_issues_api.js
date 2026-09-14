/**
 * Manual integration test for the drug issue workflow.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3000
 * - SQL migration for drug_issues already applied
 * - Seeded accounts from mysql/100_user_db.sql available
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
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[ISSUES TEST]${colors.reset} ${msg}`);
const logSuccess = (msg) => console.log(`  ${colors.green}✓${colors.reset} ${msg}`);
const logWarn = (msg) => console.log(`  ${colors.yellow}!${colors.reset} ${msg}`);
const logError = (msg) => console.error(`  ${colors.red}✗${colors.reset} ${msg}`);

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

async function login(username, password = DEFAULT_PASSWORD) {
    const response = await apiRequest('/api/auth/login', 'POST', {
        username,
        password,
    });

    if (!response.ok) {
        throw new Error(`Login failed for ${username}: ${JSON.stringify(response.data)}`);
    }

    return response.data?.data?.token;
}

async function getAuthenticatedUser(token) {
    const response = await apiRequest('/api/auth/me', 'GET', null, token);

    if (!response.ok) {
        throw new Error(`Failed to load authenticated user: ${JSON.stringify(response.data)}`);
    }

    return response.data?.data?.user ?? response.data?.data;
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
    const guestResponse = await apiRequest('/api/auth/new-guest', 'POST');
    if (!guestResponse.ok) {
        throw new Error(`Failed to create guest account: ${JSON.stringify(guestResponse.data)}`);
    }

    const guestUsername = guestResponse.data?.data?.guestUsername;
    const guestAuthToken = guestResponse.data?.data?.guestAuthToken;
    const registerResponse = await apiRequest('/api/auth/register-guest', 'POST', {
        guestUsername,
        guestAuthToken,
        username,
        email,
        password: DEFAULT_PASSWORD,
        role,
    });

    if (!registerResponse.ok) {
        throw new Error(`Failed to register ${role}: ${JSON.stringify(registerResponse.data)}`);
    }

    return {
        username,
        email,
        token: registerResponse.data?.data?.token,
        user: registerResponse.data?.data?.user,
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

async function getFirstDrugId(token) {
    const response = await apiRequest('/api/drugs/search?q=Aspirin&per_page=1', 'GET', null, token);
    if (!response.ok) {
        throw new Error(`Drug search failed: ${JSON.stringify(response.data)}`);
    }

    const firstDrug = response.data?.results?.[0];
    const drugId = firstDrug?.drug_id || firstDrug?.id;

    if (!drugId) {
        throw new Error('No drug returned from search.');
    }

    return drugId;
}

async function run() {
    log('Starting issue workflow test...');
    let connection = null;

    try {
        connection = await connectDb();
        logSuccess(`Connected to MySQL at ${DB_HOST}:${DB_PORT}.`);

        const guestResponse = await apiRequest('/api/auth/new-guest', 'POST');
        const guestToken = guestResponse.data?.data?.token;
        if (guestResponse.ok && guestToken) {
            logSuccess('Guest session created.');
        } else {
            throw new Error(`Failed to create guest session: ${JSON.stringify(guestResponse.data)}`);
        }

        const reportingUser = await createRegisteredAccount('issue_user', 'user');
        await markAccountReady(connection, reportingUser);
        const userToken = reportingUser.token;
        logSuccess(`Created verified reporting user ${reportingUser.username}.`);

        const doctorAccount = await createRegisteredAccount('issue_doctor', 'doctor');
        await markAccountReady(connection, doctorAccount, { approveDoctor: true });
        const doctorToken = doctorAccount.token;
        logSuccess(`Created approved doctor ${doctorAccount.username}.`);
        const doctorUser = await getAuthenticatedUser(doctorToken);
        logSuccess(`Loaded doctor identity as user #${doctorUser?.id}.`);

        const adminToken = await login('admin', ADMIN_PASSWORD);
        logSuccess('Logged in as seeded admin account.');

        const drugId = await getFirstDrugId(userToken);
        logSuccess(`Found target drug ${drugId}.`);

        const guestCreate = await apiRequest('/api/issues', 'POST', {
            drugId,
            partKey: 'dosage_strength',
            message: 'Guest users should not be allowed to report issues.',
        }, guestToken);

        if (guestCreate.status === 403) {
            logSuccess('Guest users are blocked from issue reporting.');
        } else {
            logWarn(`Guest report attempt returned ${guestCreate.status}: ${JSON.stringify(guestCreate.data)}`);
        }

        const createdIssue = await apiRequest('/api/issues', 'POST', {
            drugId,
            partKey: 'dosage_strength',
            message: 'The dosage form looks incorrect in the viewer.',
        }, userToken);

        if (!createdIssue.ok) {
            throw new Error(`Failed to create first issue: ${JSON.stringify(createdIssue.data)}`);
        }

        const firstIssueId = createdIssue.data?.data?.id;
        logSuccess(`Verified user reported issue #${firstIssueId}.`);

        const myIssues = await apiRequest(`/api/issues/mine?drugId=${drugId}`, 'GET', null, userToken);
        if (myIssues.ok && Array.isArray(myIssues.data?.data) && myIssues.data.data.length > 0) {
            logSuccess('User can read back issues for the same drug.');
        } else {
            throw new Error(`Failed to fetch user issues: ${JSON.stringify(myIssues.data)}`);
        }

        const doctorList = await apiRequest('/api/issues?status=open', 'GET', null, doctorToken);
        if (!doctorList.ok) {
            throw new Error(`Doctor list failed: ${JSON.stringify(doctorList.data)}`);
        }
        logSuccess('Approved doctor can list open issues.');

        const doctorDetail = await apiRequest(`/api/issues/${firstIssueId}`, 'GET', null, doctorToken);
        if (!doctorDetail.ok) {
            throw new Error(`Doctor detail failed: ${JSON.stringify(doctorDetail.data)}`);
        }
        logSuccess('Approved doctor can inspect issue detail.');

        const closeIssue = await apiRequest(`/api/issues/${firstIssueId}/close`, 'POST', {
            replyMessage: 'Thanks, we reviewed this and closed the report.',
        }, doctorToken);

        if (!closeIssue.ok) {
            throw new Error(`Doctor close failed: ${JSON.stringify(closeIssue.data)}`);
        }
        logSuccess('Doctor can reply and close an issue.');

        const secondIssue = await apiRequest('/api/issues', 'POST', {
            drugId,
            partKey: 'notes',
            message: 'The notes section needs an update.',
        }, userToken);

        if (!secondIssue.ok) {
            throw new Error(`Failed to create second issue: ${JSON.stringify(secondIssue.data)}`);
        }

        const secondIssueId = secondIssue.data?.data?.id;
        logSuccess(`Created second issue #${secondIssueId} for fix flow.`);

        const drugBeforeUpdate = await apiRequest(`/api/drugs/${drugId}`, 'GET', null, doctorToken);
        if (!drugBeforeUpdate.ok) {
            throw new Error(`Failed to load drug before update: ${JSON.stringify(drugBeforeUpdate.data)}`);
        }

        const updateDrug = await apiRequest(`/api/drugs/${drugId}`, 'PUT', {
            generic_name: drugBeforeUpdate.data?.generic_name,
        }, doctorToken);

        if (!updateDrug.ok) {
            throw new Error(`Drug update failed: ${JSON.stringify(updateDrug.data)}`);
        }
        if (Number(updateDrug.data?.doctor_id) !== Number(doctorUser?.id)) {
            throw new Error(
                `Doctor attribution failed: expected doctor_id=${doctorUser?.id}, got ${updateDrug.data?.doctor_id}`
            );
        }
        logSuccess(`Drug update was attributed to doctor #${doctorUser?.id}.`);

        const newVersionNumber = updateDrug.data?.version_number;
        const fixIssue = await apiRequest(`/api/issues/${secondIssueId}/fix`, 'POST', {
            resolvedVersionNumber: newVersionNumber,
        }, doctorToken);

        if (!fixIssue.ok) {
            throw new Error(`Doctor fix failed: ${JSON.stringify(fixIssue.data)}`);
        }
        logSuccess(`Doctor linked issue #${secondIssueId} to version ${newVersionNumber}.`);

        const adminList = await apiRequest('/api/issues?status=all', 'GET', null, adminToken);
        if (adminList.ok) {
            logSuccess('Admin can access the issue listing endpoint.');
        } else {
            logWarn(`Admin issue listing returned ${adminList.status}: ${JSON.stringify(adminList.data)}`);
        }

        logWarn('Pending doctor access is not covered here because it requires an unapproved verified doctor account.');
        logSuccess('Issue workflow test completed.');
    } catch (error) {
        logError(error.message);
        process.exitCode = 1;
    } finally {
        if (connection) {
            await connection.end();
        }
    }
}

run();
