/**
 * Manual integration test for the Admin Ops MVP.
 *
 * Prerequisites:
 * - Backend running on http://localhost:3000 or set BASE_URL
 * - MySQL migration 105_admin_ops.sql applied
 * - Drug API running and seeded drug data available
 */

const BASE_URL = process.env.BASE_URL || 'http://localhost:3000';
const DEFAULT_PASSWORD = 'Password123!';
const ADMIN_PASSWORD = 'AdminPassword1!';

const colors = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    red: '\x1b[31m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m'
};

const log = (msg) => console.log(`${colors.blue}[ADMIN OPS TEST]${colors.reset} ${msg}`);
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

async function createRegisteredUser(prefix, role = 'user') {
    const guest = await expectOk('Create guest session', apiRequest('/api/auth/new-guest', 'POST'));
    const guestData = guest?.data || {};
    const timestamp = Date.now();
    const username = `${prefix}_${timestamp}`;
    const email = `${username}@example.com`;

    const registered = await expectOk(`Register ${role} ${username}`, apiRequest('/api/auth/register-guest', 'POST', {
        guestUsername: guestData.guestUsername,
        guestAuthToken: guestData.guestAuthToken,
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

async function getFirstDrugId(token) {
    const response = await expectOk('Find a drug for admin flag testing', apiRequest('/api/drugs/search?q=Aspirin&per_page=1', 'GET', null, token));
    const firstDrug = response?.results?.[0];
    const drugId = firstDrug?.drug_id || firstDrug?.id;
    if (!drugId) {
        throw new Error('Drug search returned no drug id.');
    }
    return drugId;
}

async function run() {
    log('Starting admin ops workflow test...');

    try {
        const adminToken = await login('admin', ADMIN_PASSWORD);
        const user = await createRegisteredUser('adminops_user', 'user');
        const pendingDoctor = await createRegisteredUser('adminops_doctor', 'doctor');

        await expectOk('Load admin summary', apiRequest('/api/admin/summary', 'GET', null, adminToken));

        const users = await expectOk('List users', apiRequest('/api/admin/users?role=user&per_page=10', 'GET', null, adminToken));
        const createdUserId = user.user?.id || users?.data?.users?.find((entry) => entry.username === user.username)?.id;
        if (!createdUserId) throw new Error('Created user not found in admin list.');

        await expectOk('Load user detail', apiRequest(`/api/admin/users/${createdUserId}`, 'GET', null, adminToken));
        await expectOk('Resend verification for unverified user', apiRequest(`/api/admin/users/${createdUserId}/resend-verification`, 'POST', {
            reason: 'Admin ops integration test'
        }, adminToken));

        await expectOk('Suspend user', apiRequest(`/api/admin/users/${createdUserId}/status`, 'PATCH', {
            accountStatus: 'suspended',
            reason: 'Admin ops integration test suspension'
        }, adminToken));

        const suspendedLogin = await apiRequest('/api/auth/login', 'POST', {
            identifier: user.username,
            password: DEFAULT_PASSWORD,
        });
        if (suspendedLogin.status !== 403) {
            throw new Error(`Suspended user login should be blocked, got ${suspendedLogin.status}: ${JSON.stringify(suspendedLogin.data)}`);
        }
        logSuccess('Suspended user login is blocked.');

        await expectOk('Reactivate user', apiRequest(`/api/admin/users/${createdUserId}/status`, 'PATCH', {
            accountStatus: 'active',
            reason: 'Admin ops integration test reactivation'
        }, adminToken));

        const doctors = await expectOk('List pending doctors', apiRequest('/api/admin/doctors?verification_status=pending&per_page=20', 'GET', null, adminToken));
        const pendingDoctorId = pendingDoctor.user?.id || doctors?.data?.doctors?.find((entry) => entry.username === pendingDoctor.username)?.id;
        if (!pendingDoctorId) throw new Error('Created pending doctor not found in admin doctor list.');

        const pendingDoctorToken = await login(pendingDoctor.username);
        const drugId = await getFirstDrugId(adminToken);
        const blockedDoctorUpdate = await apiRequest(`/api/drugs/${drugId}`, 'PUT', { generic_name: 'blocked-test' }, pendingDoctorToken);
        if (blockedDoctorUpdate.status !== 403) {
            logWarn(`Pending doctor update returned ${blockedDoctorUpdate.status}; expected 403.`);
        } else {
            logSuccess('Pending doctor cannot update drug catalog.');
        }

        await expectOk('Approve pending doctor', apiRequest(`/api/admin/doctors/${pendingDoctorId}/verification`, 'PATCH', {
            verifiedDoctor: true,
            reason: 'Admin ops integration test approval'
        }, adminToken));

        await expectOk('Load admin drug detail', apiRequest(`/api/admin/drugs/${drugId}`, 'GET', null, adminToken));
        await expectOk('Reset drug flags', apiRequest(`/api/admin/drugs/${drugId}/flags`, 'PATCH', {
            visibility: 'visible',
            reviewStatus: 'published',
            adminNotes: 'Reset by admin ops integration test',
            reason: 'Admin ops integration test reset'
        }, adminToken));

        await expectOk('Mark drug as needs review', apiRequest(`/api/admin/drugs/${drugId}/flags`, 'PATCH', {
            visibility: 'visible',
            reviewStatus: 'needs_review',
            adminNotes: 'Needs review by admin ops integration test',
            reason: 'Admin ops integration test review'
        }, adminToken));

        const publicReviewDetail = await apiRequest(`/api/drugs/${drugId}`, 'GET', null, user.token);
        if (publicReviewDetail.status !== 404) {
            throw new Error(`Needs-review drug should be blocked from normal user detail, got ${publicReviewDetail.status}`);
        }
        logSuccess('Needs-review drug is blocked from normal user detail.');

        const doctorReviewDetail = await apiRequest(`/api/drugs/${drugId}`, 'GET', null, pendingDoctorToken);
        if (!doctorReviewDetail.ok || doctorReviewDetail.data?.adminFlags?.reviewStatus !== 'needs_review') {
            throw new Error(`Approved doctor should see needs-review flag, got ${doctorReviewDetail.status}: ${JSON.stringify(doctorReviewDetail.data)}`);
        }
        logSuccess('Approved doctor can see needs-review status.');

        await expectOk('Hide drug', apiRequest(`/api/admin/drugs/${drugId}/flags`, 'PATCH', {
            visibility: 'hidden',
            reviewStatus: 'needs_review',
            adminNotes: 'Hidden by admin ops integration test',
            reason: 'Admin ops integration test hide'
        }, adminToken));

        const publicHiddenDetail = await apiRequest(`/api/drugs/${drugId}`, 'GET', null, user.token);
        if (publicHiddenDetail.status !== 404) {
            throw new Error(`Hidden drug should be blocked from normal user detail, got ${publicHiddenDetail.status}`);
        }
        logSuccess('Hidden drug is blocked from normal user detail.');

        const doctorHiddenDetail = await apiRequest(`/api/drugs/${drugId}`, 'GET', null, pendingDoctorToken);
        if (doctorHiddenDetail.status !== 404) {
            throw new Error(`Hidden drug should be blocked from approved doctor detail, got ${doctorHiddenDetail.status}`);
        }
        logSuccess('Hidden drug is blocked from approved doctor detail.');

        await expectOk('Unhide drug', apiRequest(`/api/admin/drugs/${drugId}/flags`, 'PATCH', {
            visibility: 'visible',
            reviewStatus: 'published',
            adminNotes: 'Restored by admin ops integration test',
            reason: 'Admin ops integration test restore'
        }, adminToken));

        await expectOk('Revoke pending doctor approval', apiRequest(`/api/admin/doctors/${pendingDoctorId}/verification`, 'PATCH', {
            verifiedDoctor: false,
            reason: 'Admin ops integration test revoke'
        }, adminToken));

        const versions = await expectOk('List drug versions', apiRequest(`/api/admin/drugs/${drugId}/versions`, 'GET', null, adminToken));
        const currentVersion = versions?.data?.versions?.find((entry) => entry.is_current);
        if (currentVersion?.version_number) {
            await expectOk('Promote current version with audit reason', apiRequest(`/api/admin/drugs/${drugId}/current-version`, 'PUT', {
                versionNumber: currentVersion.version_number,
                reason: 'Admin ops integration test promote current version'
            }, adminToken));
        } else {
            logWarn('No current version found to promote.');
        }

        await expectOk('List drug audit events', apiRequest(`/api/admin/audit?entity_type=drug&entity_id=${drugId}`, 'GET', null, adminToken));
        logSuccess('Admin ops workflow test completed.');
    } catch (error) {
        logError(error.message);
        process.exitCode = 1;
    }
}

run();
