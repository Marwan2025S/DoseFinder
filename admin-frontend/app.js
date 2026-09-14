(function () {
    const ADMIN_TOKEN_KEY = 'dms_admin_token';
    const configuredApiBase =
        window.__ADMIN_API_BASE__
        || document.querySelector('meta[name="admin-api-base"]')?.content
        || '';
    const isLocalHost = ['localhost', '127.0.0.1', '[::1]'].includes(window.location.hostname);
    const defaultApiBases = [
        configuredApiBase,
        `${window.location.origin}/api`,
        ...(isLocalHost ? [
            `${window.location.protocol}//${window.location.hostname}:3001/api`,
            `${window.location.protocol}//${window.location.hostname}:3000/api`,
        ] : []),
    ].filter(Boolean);

    const state = {
        token: window.localStorage.getItem(ADMIN_TOKEN_KEY),
        currentAdmin: null,
        activeTab: 'overview',
        overview: null,
        users: {
            q: '',
            role: '',
            accountStatus: '',
            emailStatus: '',
            page: 1,
            perPage: 25,
            total: 0,
            results: [],
            selected: null,
        },
        doctors: {
            q: '',
            verificationStatus: '',
            accountStatus: '',
            page: 1,
            perPage: 25,
            total: 0,
            results: [],
            selected: null,
        },
        drugs: {
            q: '',
            visibility: '',
            reviewStatus: '',
            page: 1,
            perPage: 25,
            total: 0,
            results: [],
            selectedDetail: null,
            compareVersions: [],
        },
        issues: {
            q: '',
            status: 'open',
            page: 1,
            perPage: 50,
            total: 0,
            results: [],
            selected: null,
            replyMessage: '',
        },
        audit: {
            action: '',
            entityType: '',
            entityId: '',
            page: 1,
            perPage: 25,
            total: 0,
            results: [],
        },
    };

    const $ = (id) => document.getElementById(id);

    const elements = {
        loginScreen: $('loginScreen'),
        adminShell: $('adminShell'),
        loginForm: $('loginForm'),
        usernameInput: $('usernameInput'),
        passwordInput: $('passwordInput'),
        loginButton: $('loginButton'),
        logoutButton: $('logoutButton'),
        currentAdminName: $('currentAdminName'),
        statusBanner: $('statusBanner'),
        tabButtons: Array.from(document.querySelectorAll('.tab-button')),
        panels: {
            overview: $('overviewPanel'),
            users: $('usersPanel'),
            doctors: $('doctorsPanel'),
            drugs: $('drugsPanel'),
            issues: $('issuesPanel'),
            audit: $('auditPanel'),
        },
        overviewCards: $('overviewCards'),
        overviewAuditList: $('overviewAuditList'),
        refreshOverviewButton: $('refreshOverviewButton'),
        userSearchForm: $('userSearchForm'),
        userSearchInput: $('userSearchInput'),
        userRoleFilter: $('userRoleFilter'),
        userStatusFilter: $('userStatusFilter'),
        userEmailFilter: $('userEmailFilter'),
        usersTableBody: $('usersTableBody'),
        userResultsMeta: $('userResultsMeta'),
        userDetailPanel: $('userDetailPanel'),
        prevUserPageButton: $('prevUserPageButton'),
        nextUserPageButton: $('nextUserPageButton'),
        doctorSearchForm: $('doctorSearchForm'),
        doctorSearchInput: $('doctorSearchInput'),
        doctorVerificationFilter: $('doctorVerificationFilter'),
        doctorStatusFilter: $('doctorStatusFilter'),
        doctorsTableBody: $('doctorsTableBody'),
        doctorResultsMeta: $('doctorResultsMeta'),
        doctorDetailPanel: $('doctorDetailPanel'),
        prevDoctorPageButton: $('prevDoctorPageButton'),
        nextDoctorPageButton: $('nextDoctorPageButton'),
        drugSearchForm: $('drugSearchForm'),
        drugSearchInput: $('drugSearchInput'),
        drugVisibilityFilter: $('drugVisibilityFilter'),
        drugReviewFilter: $('drugReviewFilter'),
        drugsTableBody: $('drugsTableBody'),
        drugResultsMeta: $('drugResultsMeta'),
        drugDetailPanel: $('drugDetailPanel'),
        prevDrugPageButton: $('prevDrugPageButton'),
        nextDrugPageButton: $('nextDrugPageButton'),
        issueSearchForm: $('issueSearchForm'),
        issueSearchInput: $('issueSearchInput'),
        issueStatusFilter: $('issueStatusFilter'),
        issuesTableBody: $('issuesTableBody'),
        issueResultsMeta: $('issueResultsMeta'),
        issueDetailPanel: $('issueDetailPanel'),
        auditSearchForm: $('auditSearchForm'),
        auditActionInput: $('auditActionInput'),
        auditEntityTypeInput: $('auditEntityTypeInput'),
        auditEntityIdInput: $('auditEntityIdInput'),
        auditTableBody: $('auditTableBody'),
        auditResultsMeta: $('auditResultsMeta'),
        prevAuditPageButton: $('prevAuditPageButton'),
        nextAuditPageButton: $('nextAuditPageButton'),
        reasonModal: $('reasonModal'),
        reasonModalForm: $('reasonModalForm'),
        reasonModalTitle: $('reasonModalTitle'),
        reasonModalMessage: $('reasonModalMessage'),
        reasonModalLabel: $('reasonModalLabel'),
        reasonModalTextarea: $('reasonModalTextarea'),
        reasonModalError: $('reasonModalError'),
        reasonModalCancel: $('reasonModalCancel'),
        reasonModalConfirm: $('reasonModalConfirm'),
    };

    let reasonModalState = null;

    function getApiBases() {
        return Array.from(new Set(defaultApiBases));
    }

    function escapeHtml(value) {
        return String(value ?? '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function formatDate(value) {
        if (!value) return 'Unknown';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return 'Unknown';
        return new Intl.DateTimeFormat(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }).format(date);
    }

    function formatNumber(value) {
        return new Intl.NumberFormat().format(Number(value || 0));
    }

    function normalizePositiveInt(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function setStatus(message, tone = 'success') {
        if (!message) {
            elements.statusBanner.textContent = '';
            elements.statusBanner.className = 'status-banner hidden';
            return;
        }
        elements.statusBanner.textContent = message;
        elements.statusBanner.className = `status-banner status-banner--${tone}`;
    }

    function setToken(token) {
        state.token = token || null;
        if (token) {
            window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
        } else {
            window.localStorage.removeItem(ADMIN_TOKEN_KEY);
        }
    }

    async function apiRequest(path, options = {}) {
        let lastError = null;

        for (const base of getApiBases()) {
            const url = new URL(`${base}${path}`);
            const headers = { Accept: 'application/json' };

            if (options.params) {
                Object.entries(options.params).forEach(([key, value]) => {
                    if (value !== undefined && value !== null && value !== '') {
                        url.searchParams.set(key, value);
                    }
                });
            }

            if (options.tokenOverride || state.token) {
                headers.Authorization = `Bearer ${options.tokenOverride || state.token}`;
            }

            if (options.body !== undefined) {
                headers['Content-Type'] = 'application/json';
            }

            try {
                const response = await window.fetch(url.toString(), {
                    method: options.method || (options.body !== undefined ? 'POST' : 'GET'),
                    headers,
                    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
                });
                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    const error = new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
                    error.status = response.status;
                    error.payload = payload;
                    throw error;
                }
                return payload;
            } catch (error) {
                if (error?.status) throw error;
                lastError = error;
            }
        }

        throw new Error(lastError?.message || 'Unable to reach the backend API.');
    }

    function tag(text, tone = '') {
        return `<span class="tag ${tone ? `tag--${tone}` : ''}">${escapeHtml(text)}</span>`;
    }

    function accountStatusTag(status) {
        return status === 'suspended' ? tag('Suspended', 'danger') : tag('Active', 'success');
    }

    function emailStatusTag(isVerified) {
        return isVerified ? tag('Verified', 'success') : tag('Unverified', 'warning');
    }

    function doctorStatusTag(isVerified) {
        return isVerified ? tag('Approved', 'success') : tag('Pending', 'warning');
    }

    function visibilityTag(value) {
        return value === 'hidden' ? tag('Hidden', 'danger') : tag('Visible', 'success');
    }

    function reviewStatusTag(value) {
        return value === 'needs_review' ? tag('Needs review', 'warning') : tag('Published', 'info');
    }

    function issueStatusTag(status) {
        if (status === 'fixed') return tag('Fixed', 'success');
        if (status === 'closed') return tag('Closed', 'info');
        return tag('Open', 'warning');
    }

    function renderEmptyRow(colspan, message) {
        return `<tr><td colspan="${colspan}"><div class="empty-state">${escapeHtml(message)}</div></td></tr>`;
    }

    function renderEmptyPanel(message) {
        return `<div class="empty-state">${escapeHtml(message)}</div>`;
    }

    function updatePager(prevButton, nextButton, page, perPage, total) {
        if (!prevButton || !nextButton) return;
        const hasNext = page * perPage < total;
        prevButton.disabled = page <= 1;
        nextButton.disabled = !hasNext;
    }

    function getPayloadData(response, fallback = null) {
        return response?.data ?? fallback;
    }

    function parseBrandNames(value) {
        if (Array.isArray(value)) {
            return value.map((item) => String(item || '').trim()).filter(Boolean);
        }
        if (typeof value !== 'string' || !value.trim()) return [];
        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return parsed.map((item) => String(item || '').trim()).filter(Boolean);
            }
            return [String(parsed || '').trim()].filter(Boolean);
        } catch {
            return value.split(',').map((item) => item.trim()).filter(Boolean);
        }
    }

    function getDrugTitle(drug) {
        const brandNames = parseBrandNames(drug?.brand_names);
        return drug?.generic_name || drug?.display_name || drug?.name || brandNames[0] || `Drug #${drug?.drug_id || drug?.id || 'Unknown'}`;
    }

    function getDrugSubtitle(drug) {
        const brandNames = parseBrandNames(drug?.brand_names);
        if (brandNames.length) {
            return brandNames.join(', ');
        }
        return drug?.source || `Drug #${drug?.drug_id || drug?.id || 'Unknown'}`;
    }

    function buildReviewUrl(drugId, options = {}) {
        const params = new URLSearchParams({ drugId: String(drugId) });
        if (options.versionNumber) {
            params.set('version', String(options.versionNumber));
        }
        if (Array.isArray(options.compareVersions) && options.compareVersions.length === 2) {
            params.set('compare', options.compareVersions.join(','));
        }
        return `./review.html?${params.toString()}`;
    }

    function openReasonDialog({
        title = 'Confirm action',
        message = '',
        label = 'Reason',
        required = false,
        confirmText = 'Continue',
        defaultValue = '',
    } = {}) {
        return new Promise((resolve) => {
            reasonModalState = { resolve, required };
            elements.reasonModalTitle.textContent = title;
            elements.reasonModalMessage.textContent = message;
            elements.reasonModalLabel.textContent = label;
            elements.reasonModalTextarea.value = defaultValue;
            elements.reasonModalConfirm.textContent = confirmText;
            elements.reasonModalError.classList.add('hidden');
            elements.reasonModal.classList.remove('hidden');
            elements.reasonModalTextarea.focus();
        });
    }

    function closeReasonDialog(value) {
        elements.reasonModal.classList.add('hidden');
        const resolver = reasonModalState?.resolve;
        reasonModalState = null;
        if (resolver) resolver(value);
    }

    function enterAuthenticatedState() {
        elements.loginScreen.classList.add('hidden');
        elements.adminShell.classList.remove('hidden');
    }

    function leaveAuthenticatedState() {
        const token = state.token;
        if (token) {
            apiRequest('/auth/logout', { method: 'POST', tokenOverride: token }).catch(() => null);
        }
        setToken(null);
        state.currentAdmin = null;
        elements.loginScreen.classList.remove('hidden');
        elements.adminShell.classList.add('hidden');
        setStatus('', '');
    }

    async function loadCurrentAdmin() {
        const response = await apiRequest('/auth/me');
        const user = response?.data?.user;
        if (!user || user.role !== 'admin') {
            throw new Error('This admin site only accepts admin accounts.');
        }
        state.currentAdmin = user;
        elements.currentAdminName.textContent = user.username;
        return user;
    }

    function switchTab(tabName) {
        state.activeTab = tabName;
        elements.tabButtons.forEach((button) => {
            button.classList.toggle('tab-button--active', button.dataset.tab === tabName);
        });
        Object.entries(elements.panels).forEach(([key, panel]) => {
            panel.classList.toggle('hidden', key !== tabName);
        });
        refreshCurrentTab().catch((error) => setStatus(error.message || 'Failed to load section.', 'error'));
    }

    async function refreshCurrentTab() {
        if (!state.token) return;
        if (state.activeTab === 'overview') return loadOverview();
        if (state.activeTab === 'users') return loadUsers();
        if (state.activeTab === 'doctors') return loadDoctors();
        if (state.activeTab === 'drugs') return loadDrugs();
        if (state.activeTab === 'issues') return loadIssues();
        if (state.activeTab === 'audit') return loadAuditEvents();
    }

    async function loadOverview() {
        const response = await apiRequest('/admin/summary');
        state.overview = getPayloadData(response, {});
        renderOverview();
    }

    function renderOverview() {
        const data = state.overview || {};
        const users = data.users || {};
        const doctors = data.doctors || {};
        const drugs = data.drugs || {};
        const issues = data.issues || {};
        const issueStatus = issues.byStatus || {};

        elements.overviewCards.innerHTML = [
            ['Users', users.total, `${formatNumber(users.byStatus?.active || 0)} active`],
            ['Doctors', doctors.pending, `${formatNumber(doctors.approved || 0)} approved`],
            ['Drugs', drugs.total, `${formatNumber(drugs.hidden || 0)} hidden`],
            ['Needs review', drugs.needsReview, 'Drug catalog'],
            ['Open issues', issueStatus.open || 0, `${formatNumber(issues.total || 0)} total`],
            ['Versions', drugs.totalVersions, 'Stored snapshots'],
        ].map(([label, value, subline]) => `
            <article class="metric-card">
                <span>${escapeHtml(label)}</span>
                <strong>${formatNumber(value)}</strong>
                <p class="muted">${escapeHtml(subline)}</p>
            </article>
        `).join('');

        const events = Array.isArray(data.recentAudit) ? data.recentAudit : [];
        elements.overviewAuditList.innerHTML = events.length
            ? events.map(renderActivityItem).join('')
            : renderEmptyPanel('No admin activity has been recorded yet.');
    }

    function renderActivityItem(event) {
        return `
            <article class="activity-item">
                <strong>${escapeHtml(event.action)}</strong>
                <div class="activity-meta">
                    ${escapeHtml(event.entityType)} #${escapeHtml(event.entityId)}
                    by ${escapeHtml(event.actorUsername || 'System')}
                    on ${escapeHtml(formatDate(event.createdAt))}
                </div>
                ${event.reason ? `<p class="audit-reason">${escapeHtml(event.reason)}</p>` : ''}
            </article>
        `;
    }

    async function loadUsers() {
        const response = await apiRequest('/admin/users', {
            params: {
                q: state.users.q,
                role: state.users.role,
                account_status: state.users.accountStatus,
                email_status: state.users.emailStatus,
                page: state.users.page,
                per_page: state.users.perPage,
            },
        });
        const data = getPayloadData(response, {});
        state.users.results = Array.isArray(data.users) ? data.users : [];
        state.users.total = Number(data.total || 0);
        state.users.page = Number(data.page || state.users.page);
        state.users.perPage = Number(data.perPage || state.users.perPage);
        renderUsers();
    }

    function renderUsers() {
        const users = state.users.results;
        elements.usersTableBody.innerHTML = users.length ? users.map((user) => `
            <tr>
                <td>
                    <div class="entity-cell">
                        <strong>${escapeHtml(user.displayName || user.username)}</strong>
                        <span>${escapeHtml(user.username)} · ID ${escapeHtml(user.id)}</span>
                    </div>
                </td>
                <td>${tag(user.role || 'unknown', user.role === 'admin' ? 'info' : '')}</td>
                <td>
                    <div class="tag-stack">
                        ${emailStatusTag(user.emailVerified)}
                    </div>
                    <div class="muted">${escapeHtml(user.email || 'No email')}</div>
                </td>
                <td>${accountStatusTag(user.accountStatus)}</td>
                <td>${escapeHtml(formatDate(user.createdAt))}</td>
                <td>
                    <div class="action-row">
                        <button type="button" class="ghost-button" data-user-detail="${user.id}">Details</button>
                        ${user.role !== 'guest' ? `<button type="button" class="ghost-button" data-user-status="${user.id}" data-next-status="${user.accountStatus === 'suspended' ? 'active' : 'suspended'}">${user.accountStatus === 'suspended' ? 'Reactivate' : 'Suspend'}</button>` : ''}
                        ${!user.emailVerified && user.role !== 'guest' ? `<button type="button" class="ghost-button" data-resend-verification="${user.id}">Resend email</button>` : ''}
                    </div>
                </td>
            </tr>
        `).join('') : renderEmptyRow(6, 'No users matched this search.');

        elements.userResultsMeta.textContent = `${formatNumber(users.length)} shown of ${formatNumber(state.users.total)} users`;
        updatePager(elements.prevUserPageButton, elements.nextUserPageButton, state.users.page, state.users.perPage, state.users.total);
        renderUserDetail();
    }

    function renderUserDetail() {
        const user = state.users.selected;
        if (!user) {
            elements.userDetailPanel.innerHTML = renderEmptyPanel('Select a user to inspect account activity.');
            return;
        }
        const stats = user.stats || {};
        elements.userDetailPanel.innerHTML = `
            <div class="detail-stack">
                <h3>${escapeHtml(user.displayName || user.username)}</h3>
                <div class="tag-stack">
                    ${tag(user.role || 'unknown', user.role === 'admin' ? 'info' : '')}
                    ${accountStatusTag(user.accountStatus)}
                    ${emailStatusTag(user.emailVerified)}
                    ${user.role === 'doctor' ? doctorStatusTag(user.verifiedDoctor) : ''}
                </div>
                <div class="detail-field"><span>Email</span><strong>${escapeHtml(user.email || 'No email')}</strong></div>
                <div class="detail-field"><span>Saved drugs</span><strong>${formatNumber(stats.savedDrugCount)}</strong></div>
                <div class="detail-field"><span>Searches</span><strong>${formatNumber(stats.searchCount)}</strong></div>
                <div class="detail-field"><span>Reported issues</span><strong>${formatNumber(stats.reportedIssueCount)}</strong></div>
                <div class="detail-field"><span>Resolved issues</span><strong>${formatNumber(stats.resolvedIssueCount)}</strong></div>
                <div class="detail-field"><span>Conversations</span><strong>${formatNumber(stats.conversationCount)}</strong></div>
                <div class="detail-field"><span>Active sessions</span><strong>${formatNumber(stats.activeSessionCount)}</strong></div>
                <div class="detail-field"><span>Last login</span><strong>${escapeHtml(formatDate(stats.lastLoginAt))}</strong></div>
                ${user.accountStatus === 'suspended' ? `<div class="detail-field"><span>Suspension reason</span><div>${escapeHtml(user.suspensionReason || 'No reason stored')}</div></div>` : ''}
                <div class="button-row">
                    ${user.role !== 'guest' ? `<button type="button" class="ghost-button" data-user-status="${user.id}" data-next-status="${user.accountStatus === 'suspended' ? 'active' : 'suspended'}">${user.accountStatus === 'suspended' ? 'Reactivate' : 'Suspend'}</button>` : ''}
                    ${!user.emailVerified && user.role !== 'guest' ? `<button type="button" class="ghost-button" data-resend-verification="${user.id}">Resend email</button>` : ''}
                </div>
            </div>
        `;
    }

    async function loadUserDetail(userId) {
        const response = await apiRequest(`/admin/users/${userId}`);
        state.users.selected = getPayloadData(response, null);
        renderUserDetail();
    }

    async function updateUserStatus(userId, nextStatus) {
        const requiresReason = nextStatus === 'suspended';
        const reason = await openReasonDialog({
            title: nextStatus === 'suspended' ? 'Suspend user' : 'Reactivate user',
            message: nextStatus === 'suspended'
                ? 'The user will be blocked from login and authenticated API access.'
                : 'The user will regain account access.',
            label: 'Admin reason',
            required: requiresReason,
            confirmText: nextStatus === 'suspended' ? 'Suspend' : 'Reactivate',
        });
        if (reason === null) return;

        await apiRequest(`/admin/users/${userId}/status`, {
            method: 'PATCH',
            body: { accountStatus: nextStatus, reason },
        });
        setStatus(nextStatus === 'suspended' ? 'User suspended.' : 'User reactivated.');
        await loadUsers();
        if (state.users.selected?.id === userId) await loadUserDetail(userId);
        await loadOverview().catch(() => null);
    }

    async function resendVerification(userId) {
        const reason = await openReasonDialog({
            title: 'Resend verification',
            message: 'A new email verification OTP will be created for this user.',
            label: 'Reason',
            required: false,
            confirmText: 'Send',
        });
        if (reason === null) return;

        await apiRequest(`/admin/users/${userId}/resend-verification`, {
            method: 'POST',
            body: { reason },
        });
        setStatus('Verification email requested.');
        await loadAuditEventsIfLoaded();
    }

    async function loadDoctors() {
        const response = await apiRequest('/admin/doctors', {
            params: {
                q: state.doctors.q,
                verification_status: state.doctors.verificationStatus,
                account_status: state.doctors.accountStatus,
                page: state.doctors.page,
                per_page: state.doctors.perPage,
            },
        });
        const data = getPayloadData(response, {});
        state.doctors.results = Array.isArray(data.doctors) ? data.doctors : Array.isArray(data) ? data : [];
        state.doctors.total = Number(data.total || state.doctors.results.length || 0);
        state.doctors.page = Number(data.page || state.doctors.page);
        state.doctors.perPage = Number(data.perPage || state.doctors.perPage);
        renderDoctors();
    }

    function renderDoctors() {
        const doctors = state.doctors.results;
        elements.doctorsTableBody.innerHTML = doctors.length ? doctors.map((doctor) => `
            <tr>
                <td>
                    <div class="doctor-cell">
                        <strong>${escapeHtml(doctor.displayName || doctor.username)}</strong>
                        <span>${escapeHtml(doctor.username)} · ID ${escapeHtml(doctor.id)}</span>
                    </div>
                </td>
                <td>
                    ${emailStatusTag(doctor.emailVerified)}
                    <div class="muted">${escapeHtml(doctor.email || 'No email')}</div>
                </td>
                <td>${doctorStatusTag(doctor.verifiedDoctor)} ${accountStatusTag(doctor.accountStatus)}</td>
                <td>${formatNumber(doctor.authoredVersionCount)}</td>
                <td>${escapeHtml(formatDate(doctor.createdAt))}</td>
                <td>
                    <div class="action-row">
                        <button type="button" class="ghost-button" data-doctor-detail="${doctor.id}">Details</button>
                        <button type="button" class="ghost-button" data-toggle-doctor="${doctor.id}" data-next-status="${doctor.verifiedDoctor ? 'false' : 'true'}">${doctor.verifiedDoctor ? 'Revoke' : 'Approve'}</button>
                    </div>
                </td>
            </tr>
        `).join('') : renderEmptyRow(6, 'No doctor accounts matched this search.');

        elements.doctorResultsMeta.textContent = `${formatNumber(doctors.length)} shown of ${formatNumber(state.doctors.total)} doctors`;
        updatePager(elements.prevDoctorPageButton, elements.nextDoctorPageButton, state.doctors.page, state.doctors.perPage, state.doctors.total);
        renderDoctorDetail();
    }

    function renderDoctorDetail() {
        const doctor = state.doctors.selected;
        if (!doctor) {
            elements.doctorDetailPanel.innerHTML = renderEmptyPanel('Select a doctor to inspect approval and contribution activity.');
            return;
        }
        const activity = doctor.activity || {};
        const recentVersions = Array.isArray(activity.recentDrugVersions) ? activity.recentDrugVersions : [];
        elements.doctorDetailPanel.innerHTML = `
            <div class="detail-stack">
                <h3>${escapeHtml(doctor.displayName || doctor.username)}</h3>
                <div class="tag-stack">
                    ${doctorStatusTag(doctor.verifiedDoctor)}
                    ${accountStatusTag(doctor.accountStatus)}
                    ${emailStatusTag(doctor.emailVerified)}
                </div>
                <div class="detail-field"><span>Email</span><strong>${escapeHtml(doctor.email || 'No email')}</strong></div>
                <div class="detail-field"><span>Authored versions</span><strong>${formatNumber(activity.authoredVersionCount)}</strong></div>
                <div class="detail-field"><span>Resolved issues</span><strong>${formatNumber(activity.resolvedIssueCount)}</strong></div>
                <div class="button-row">
                    <button type="button" class="ghost-button" data-toggle-doctor="${doctor.id}" data-next-status="${doctor.verifiedDoctor ? 'false' : 'true'}">${doctor.verifiedDoctor ? 'Revoke approval' : 'Approve doctor'}</button>
                    <button type="button" class="ghost-button" data-user-detail="${doctor.id}" data-switch-tab="users">Open user</button>
                </div>
                <div class="detail-field">
                    <span>Recent versions</span>
                    <div class="activity-list">
                        ${recentVersions.length ? recentVersions.map((version) => `
                            <article class="activity-item">
                                <strong>${escapeHtml(getDrugTitle(version))}</strong>
                                <div class="activity-meta">Drug #${escapeHtml(version.drug_id)} · v${escapeHtml(version.version_number)} · ${escapeHtml(formatDate(version.updated_at))}</div>
                            </article>
                        `).join('') : '<div class="muted">No recent authored versions.</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    async function loadDoctorDetail(userId) {
        const response = await apiRequest(`/admin/doctors/${userId}`);
        state.doctors.selected = getPayloadData(response, null);
        renderDoctorDetail();
    }

    async function toggleDoctorVerification(userId, nextStatus) {
        const reason = await openReasonDialog({
            title: nextStatus ? 'Approve doctor' : 'Revoke doctor approval',
            message: nextStatus
                ? 'Approved doctors can manage drug catalog updates and issues.'
                : 'The doctor will lose drug catalog and issue-management privileges.',
            label: 'Admin reason',
            required: true,
            confirmText: nextStatus ? 'Approve' : 'Revoke',
        });
        if (reason === null) return;

        await apiRequest(`/admin/doctors/${userId}/verification`, {
            method: 'PATCH',
            body: { verifiedDoctor: nextStatus, reason },
        });
        setStatus(nextStatus ? 'Doctor approved.' : 'Doctor approval revoked.');
        await loadDoctors();
        if (state.doctors.selected?.id === userId) await loadDoctorDetail(userId);
        await loadOverview().catch(() => null);
        await loadAuditEventsIfLoaded();
    }

    async function loadDrugs() {
        const response = await apiRequest('/admin/drugs', {
            params: {
                q: state.drugs.q,
                visibility: state.drugs.visibility,
                review_status: state.drugs.reviewStatus,
                page: state.drugs.page,
                per_page: state.drugs.perPage,
            },
        });
        const data = getPayloadData(response, {});
        state.drugs.results = Array.isArray(data.results) ? data.results : [];
        state.drugs.total = Number(data.total || 0);
        state.drugs.page = Number(data.page || state.drugs.page);
        state.drugs.perPage = Number(data.per_page || data.perPage || state.drugs.perPage);
        renderDrugs();
    }

    function renderDrugs() {
        const drugs = state.drugs.results;
        elements.drugsTableBody.innerHTML = drugs.length ? drugs.map((drug) => {
            const flags = drug.adminFlags || {};
            return `
                <tr>
                    <td>
                        <div class="drug-name">
                            <strong>${escapeHtml(getDrugTitle(drug))}</strong>
                            <span>${escapeHtml(getDrugSubtitle(drug))}</span>
                            <span>ID ${escapeHtml(drug.drug_id)}</span>
                        </div>
                    </td>
                    <td>${escapeHtml(drug.source || 'Unknown')}</td>
                    <td>${tag(`v${drug.version_number || drug.latestVersionNumber || 1}`, 'info')}</td>
                    <td>
                        <div class="drug-doctor">
                            <strong>${escapeHtml(drug.latestVersionDoctor?.username || drug.assignedDoctor?.username || 'System')}</strong>
                            <span>${escapeHtml(drug.latestVersionDoctor?.email || drug.assignedDoctor?.email || 'No doctor email')}</span>
                        </div>
                    </td>
                    <td><div class="tag-stack">${visibilityTag(flags.visibility)} ${reviewStatusTag(flags.reviewStatus)}</div></td>
                    <td>${escapeHtml(formatDate(drug.updated_at))}</td>
                    <td>
                        <div class="action-row">
                            <button type="button" class="ghost-button" data-drug-detail="${drug.drug_id}">Details</button>
                            <button type="button" class="ghost-button" data-drug-quick-flag="${drug.drug_id}" data-flag-kind="visibility" data-next-value="${flags.visibility === 'hidden' ? 'visible' : 'hidden'}">${flags.visibility === 'hidden' ? 'Restore' : 'Delete'}</button>
                            <button type="button" class="ghost-button" data-drug-quick-flag="${drug.drug_id}" data-flag-kind="reviewStatus" data-next-value="${flags.reviewStatus === 'needs_review' ? 'published' : 'needs_review'}">${flags.reviewStatus === 'needs_review' ? 'Publish' : 'Review'}</button>
                        </div>
                    </td>
                </tr>
            `;
        }).join('') : renderEmptyRow(7, 'No drugs matched this search.');

        elements.drugResultsMeta.textContent = `${formatNumber(drugs.length)} shown of ${formatNumber(state.drugs.total)} drugs`;
        updatePager(elements.prevDrugPageButton, elements.nextDrugPageButton, state.drugs.page, state.drugs.perPage, state.drugs.total);
        renderDrugDetail();
    }

    function renderDrugDetail() {
        const detail = state.drugs.selectedDetail;
        if (!detail) {
            elements.drugDetailPanel.innerHTML = renderEmptyPanel('Select a drug to manage flags, versions, and related issues.');
            return;
        }

        const drug = detail.drug || {};
        const flags = detail.flags || {};
        const versions = Array.isArray(detail.versions) ? detail.versions : [];
        const relatedIssues = Array.isArray(detail.relatedIssues) ? detail.relatedIssues : [];
        const selectedCompare = state.drugs.compareVersions;
        const compareReady = selectedCompare.length === 2;
        const brandNames = parseBrandNames(drug.brand_names);
        const fdaTag = drug.has_fda ? tag('FDA', 'info') : '';

        elements.drugDetailPanel.innerHTML = `
            <div class="detail-stack">
                <h3>${escapeHtml(getDrugTitle(drug))}</h3>
                <div class="tag-stack">${visibilityTag(flags.visibility)} ${reviewStatusTag(flags.reviewStatus)} ${tag(`v${drug.version_number || 1}`, 'info')} ${fdaTag}</div>
                <div class="detail-field"><span>Generic</span><strong>${escapeHtml(drug.generic_name || 'Unknown')}</strong></div>
                <div class="detail-field"><span>Brand / trade</span><strong>${escapeHtml(brandNames.join(', ') || 'None')}</strong></div>
                <div class="detail-field"><span>Source</span><strong>${escapeHtml(drug.source || 'Unknown')}</strong></div>
                <form class="flag-form" id="drugFlagForm">
                    <label class="field">
                        <span>Visibility</span>
                        <select id="drugFlagVisibility">
                            <option value="visible" ${flags.visibility !== 'hidden' ? 'selected' : ''}>Visible</option>
                            <option value="hidden" ${flags.visibility === 'hidden' ? 'selected' : ''}>Hidden</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Review status</span>
                        <select id="drugFlagReviewStatus">
                            <option value="published" ${flags.reviewStatus !== 'needs_review' ? 'selected' : ''}>Published</option>
                            <option value="needs_review" ${flags.reviewStatus === 'needs_review' ? 'selected' : ''}>Needs review</option>
                        </select>
                    </label>
                    <label class="field">
                        <span>Admin notes</span>
                        <textarea id="drugFlagNotes" rows="4">${escapeHtml(flags.adminNotes || '')}</textarea>
                    </label>
                    <button type="button" class="primary-button" data-save-drug-flags="${drug.drug_id}">Save flags</button>
                </form>
                <div class="detail-field">
                    <span>Versions</span>
                    <div class="button-row">
                        <button type="button" class="ghost-button" data-clear-compare ${selectedCompare.length ? '' : 'disabled'}>Clear compare</button>
                        <a class="primary-button ${compareReady ? '' : 'hidden'}" href="${compareReady ? buildReviewUrl(drug.drug_id, { compareVersions: [...selectedCompare].sort((a, b) => a - b) }) : '#'}">Compare selected</a>
                    </div>
                    <div class="version-list">
                        ${versions.length ? versions.map((version) => renderVersionRow(drug.drug_id, version)) : '<div class="muted">No stored versions found.</div>'}
                    </div>
                </div>
                <div class="detail-field">
                    <span>Related issues</span>
                    <div class="activity-list">
                        ${relatedIssues.length ? relatedIssues.map((issue) => `
                            <article class="activity-item">
                                <strong>${escapeHtml(issue.part_label || 'Issue')}</strong>
                                <div class="activity-meta">#${escapeHtml(issue.id)} · ${escapeHtml(issue.status)} · ${escapeHtml(formatDate(issue.created_at))}</div>
                                <p class="issue-message">${escapeHtml(issue.message || '')}</p>
                            </article>
                        `).join('') : '<div class="muted">No related issues.</div>'}
                    </div>
                </div>
            </div>
        `;
    }

    function renderVersionRow(drugId, version) {
        const versionNumber = Number(version.version_number || version.versionNumber || 1);
        const selected = state.drugs.compareVersions.includes(versionNumber);
        return `
            <article class="version-row ${selected ? 'version-row--selected' : ''}">
                <div class="version-row__top">
                    <strong>Version ${escapeHtml(versionNumber)}</strong>
                    ${version.is_current ? tag('Current', 'success') : tag('Historical')}
                </div>
                <div class="version-row__meta">Updated ${escapeHtml(formatDate(version.updated_at))}</div>
                <div class="version-row__meta">Doctor: ${escapeHtml(version.doctor?.username || 'System')}</div>
                <div class="version-row__actions">
                    <label class="version-row__checkbox">
                        <input type="checkbox" data-compare-version="${versionNumber}" ${selected ? 'checked' : ''} />
                        Compare
                    </label>
                    <div class="button-row">
                        <a class="version-row__action" href="${buildReviewUrl(drugId, { versionNumber })}">View</a>
                        <button type="button" class="version-row__action" data-promote-version="${versionNumber}" ${version.is_current ? 'disabled' : ''}>Promote</button>
                    </div>
                </div>
            </article>
        `;
    }

    async function loadDrugDetail(drugId) {
        const response = await apiRequest(`/admin/drugs/${drugId}`);
        state.drugs.selectedDetail = getPayloadData(response, null);
        state.drugs.compareVersions = [];
        renderDrugDetail();
    }

    async function saveDrugFlags(drugId, nextFlags = null) {
        const detail = state.drugs.selectedDetail;
        const currentFlags = detail?.flags || {};
        const visibility = nextFlags?.visibility || $('drugFlagVisibility')?.value || currentFlags.visibility || 'visible';
        const reviewStatus = nextFlags?.reviewStatus || $('drugFlagReviewStatus')?.value || currentFlags.reviewStatus || 'published';
        const adminNotes = nextFlags?.adminNotes ?? $('drugFlagNotes')?.value ?? currentFlags.adminNotes ?? '';
        const reason = await openReasonDialog({
            title: 'Update drug flags',
            message: 'This updates admin visibility or review status for the selected drug.',
            label: 'Admin reason',
            required: true,
            confirmText: 'Save',
        });
        if (reason === null) return;

        await apiRequest(`/admin/drugs/${drugId}/flags`, {
            method: 'PATCH',
            body: { visibility, reviewStatus, adminNotes, reason },
        });
        setStatus('Drug flags updated.');
        await loadDrugs();
        await loadDrugDetail(drugId);
        await loadOverview().catch(() => null);
        await loadAuditEventsIfLoaded();
    }

    async function quickFlagDrug(drugId, kind, nextValue) {
        const drug = state.drugs.results.find((entry) => Number(entry.drug_id) === Number(drugId));
        const flags = drug?.adminFlags || {};
        const nextFlags = {
            visibility: kind === 'visibility' ? nextValue : (flags.visibility || 'visible'),
            reviewStatus: kind === 'reviewStatus' ? nextValue : (flags.reviewStatus || 'published'),
            adminNotes: flags.adminNotes || '',
        };
        await saveDrugFlags(drugId, nextFlags);
    }

    async function promoteVersion(versionNumber) {
        const drugId = state.drugs.selectedDetail?.drug?.drug_id;
        if (!drugId) return;
        const reason = await openReasonDialog({
            title: 'Promote version',
            message: `Version ${versionNumber} will become the current public version.`,
            label: 'Reason',
            required: false,
            confirmText: 'Promote',
        });
        if (reason === null) return;

        await apiRequest(`/admin/drugs/${drugId}/current-version`, {
            method: 'PUT',
            body: { versionNumber, reason },
        });
        setStatus(`Version ${versionNumber} promoted.`);
        await loadDrugs();
        await loadDrugDetail(drugId);
        await loadAuditEventsIfLoaded();
    }

    async function loadIssues() {
        const response = await apiRequest('/issues', {
            params: {
                status: state.issues.status,
                q: state.issues.q,
                page: state.issues.page,
                per_page: state.issues.perPage,
            },
        });
        const data = getPayloadData(response, {});
        state.issues.results = Array.isArray(data.issues) ? data.issues : [];
        state.issues.total = Number(data.total || 0);
        renderIssues();
    }

    function renderIssues() {
        const issues = state.issues.results;
        elements.issuesTableBody.innerHTML = issues.length ? issues.map((issue) => `
            <tr>
                <td>
                    <div class="entity-cell">
                        <strong>${escapeHtml(issue.drugName || 'Unknown drug')}</strong>
                        <span>Drug #${escapeHtml(issue.drugId)} · v${escapeHtml(issue.reportedVersionNumber || 'Unknown')}</span>
                    </div>
                </td>
                <td>${escapeHtml(issue.partLabel || 'Unknown')}</td>
                <td>${escapeHtml(issue.reporter?.username || 'User')}</td>
                <td>${issueStatusTag(issue.status)}</td>
                <td>${escapeHtml(formatDate(issue.createdAt))}</td>
                <td>
                    <button type="button" class="ghost-button" data-issue-detail="${issue.id}">Details</button>
                </td>
            </tr>
        `).join('') : renderEmptyRow(6, 'No issues matched this search.');

        elements.issueResultsMeta.textContent = `${formatNumber(issues.length)} issue${issues.length === 1 ? '' : 's'} shown`;
        renderIssueDetail();
    }

    function renderIssueDetail() {
        const issue = state.issues.selected;
        if (!issue) {
            elements.issueDetailPanel.innerHTML = renderEmptyPanel('Select an issue to review the report and respond.');
            return;
        }

        elements.issueDetailPanel.innerHTML = `
            <div class="detail-stack">
                <h3>${escapeHtml(issue.drugName || 'Unknown drug')}</h3>
                <div class="tag-stack">${issueStatusTag(issue.status)} ${tag(issue.partLabel || 'Issue')}</div>
                <div class="detail-field"><span>Reporter</span><strong>${escapeHtml(issue.reporter?.username || 'User')}</strong><div>${escapeHtml(issue.reporter?.email || 'No email')}</div></div>
                <div class="detail-field"><span>Message</span><p class="issue-message">${escapeHtml(issue.message || '')}</p></div>
                <div class="detail-field"><span>Reported version</span><strong>v${escapeHtml(issue.reportedVersionNumber || 'Unknown')}</strong></div>
                <div class="detail-field"><span>Current version</span><strong>${issue.currentDrug?.versionNumber ? `v${escapeHtml(issue.currentDrug.versionNumber)}` : 'Unknown'}</strong></div>
                ${issue.doctorReplyMessage ? `<div class="detail-field"><span>Reply</span><p class="issue-message">${escapeHtml(issue.doctorReplyMessage)}</p></div>` : ''}
                ${issue.status === 'open' ? `
                    <label class="field">
                        <span>Reply message</span>
                        <textarea id="issueReplyTextarea" rows="5" maxlength="1000">${escapeHtml(state.issues.replyMessage || '')}</textarea>
                    </label>
                    <div class="button-row">
                        <button type="button" class="ghost-button" data-close-issue="${issue.id}" data-with-reply="false">Close</button>
                        <button type="button" class="primary-button" data-close-issue="${issue.id}" data-with-reply="true">Reply and close</button>
                        <button type="button" class="ghost-button" data-open-issue-drug="${issue.drugId}">Open drug</button>
                    </div>
                ` : `
                    <div class="detail-field"><span>Resolved by</span><strong>${escapeHtml(issue.resolvedBy?.username || 'Unknown')}</strong></div>
                    <div class="detail-field"><span>Resolved at</span><strong>${escapeHtml(formatDate(issue.resolvedAt))}</strong></div>
                    <button type="button" class="ghost-button" data-open-issue-drug="${issue.drugId}">Open drug</button>
                `}
            </div>
        `;
    }

    async function loadIssueDetail(issueId) {
        const response = await apiRequest(`/issues/${issueId}`);
        state.issues.selected = getPayloadData(response, null);
        state.issues.replyMessage = state.issues.selected?.doctorReplyMessage || '';
        renderIssueDetail();
    }

    async function closeIssue(issueId, withReply) {
        const replyMessage = $('issueReplyTextarea')?.value?.trim() || '';
        if (withReply && !replyMessage) {
            setStatus('Write a reply before closing with a reply.', 'error');
            return;
        }

        await apiRequest(`/issues/${issueId}/close`, {
            method: 'POST',
            body: { replyMessage: withReply ? replyMessage : undefined },
        });
        setStatus(withReply ? 'Issue replied to and closed.' : 'Issue closed.');
        await loadIssueDetail(issueId);
        await loadIssues();
        await loadOverview().catch(() => null);
    }

    async function openIssueDrug(drugId) {
        switchTab('drugs');
        state.drugs.q = '';
        elements.drugSearchInput.value = '';
        await loadDrugDetail(drugId);
    }

    async function loadAuditEvents() {
        const response = await apiRequest('/admin/audit', {
            params: {
                action: state.audit.action,
                entity_type: state.audit.entityType,
                entity_id: state.audit.entityId,
                page: state.audit.page,
                per_page: state.audit.perPage,
            },
        });
        const data = getPayloadData(response, {});
        state.audit.results = Array.isArray(data.events) ? data.events : [];
        state.audit.total = Number(data.total || 0);
        state.audit.page = Number(data.page || state.audit.page);
        state.audit.perPage = Number(data.perPage || state.audit.perPage);
        renderAuditEvents();
    }

    function renderAuditEvents() {
        const events = state.audit.results;
        elements.auditTableBody.innerHTML = events.length ? events.map((event) => `
            <tr>
                <td><strong>${escapeHtml(event.action)}</strong></td>
                <td>${escapeHtml(event.entityType)} #${escapeHtml(event.entityId)}</td>
                <td>${escapeHtml(event.actorUsername || 'System')}</td>
                <td><div class="audit-reason">${escapeHtml(event.reason || 'No reason')}</div></td>
                <td>${escapeHtml(formatDate(event.createdAt))}</td>
            </tr>
        `).join('') : renderEmptyRow(5, 'No audit events matched these filters.');
        elements.auditResultsMeta.textContent = `${formatNumber(events.length)} shown of ${formatNumber(state.audit.total)} events`;
        updatePager(elements.prevAuditPageButton, elements.nextAuditPageButton, state.audit.page, state.audit.perPage, state.audit.total);
    }

    async function loadAuditEventsIfLoaded() {
        if (state.audit.results.length || state.activeTab === 'audit') {
            await loadAuditEvents();
        }
    }

    async function handleLogin(event) {
        event.preventDefault();
        const identifier = elements.usernameInput.value.trim();
        const password = elements.passwordInput.value;
        if (!identifier || !password) {
            setStatus('Email/username and password are required.', 'error');
            return;
        }

        elements.loginButton.disabled = true;
        setStatus('Signing in...');
        try {
            const response = await apiRequest('/auth/login', {
                method: 'POST',
                body: { identifier, password },
            });
            const token = response?.data?.token;
            const user = response?.data?.user;
            if (!token || !user) {
                throw new Error('Login response is missing account data.');
            }
            if (user.role !== 'admin') {
                apiRequest('/auth/logout', { method: 'POST', tokenOverride: token }).catch(() => null);
                throw new Error('This account is not allowed to open the admin site.');
            }
            setToken(token);
            await loadCurrentAdmin();
            enterAuthenticatedState();
            await loadOverview();
            elements.passwordInput.value = '';
            setStatus('Admin session ready.');
        } catch (error) {
            leaveAuthenticatedState();
            setStatus(error.message || 'Login failed.', 'error');
        } finally {
            elements.loginButton.disabled = false;
        }
    }

    function bindEvents() {
        elements.loginForm.addEventListener('submit', handleLogin);
        elements.logoutButton.addEventListener('click', leaveAuthenticatedState);

        elements.tabButtons.forEach((button) => {
            button.addEventListener('click', () => switchTab(button.dataset.tab));
        });

        elements.refreshOverviewButton.addEventListener('click', () => {
            loadOverview()
                .then(() => setStatus('Overview refreshed.'))
                .catch((error) => setStatus(error.message || 'Failed to refresh overview.', 'error'));
        });

        elements.userSearchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            state.users.q = elements.userSearchInput.value.trim();
            state.users.role = elements.userRoleFilter.value;
            state.users.accountStatus = elements.userStatusFilter.value;
            state.users.emailStatus = elements.userEmailFilter.value;
            state.users.page = 1;
            loadUsers().catch((error) => setStatus(error.message || 'Failed to load users.', 'error'));
        });
        elements.prevUserPageButton.addEventListener('click', () => {
            if (state.users.page <= 1) return;
            state.users.page -= 1;
            loadUsers().catch((error) => setStatus(error.message || 'Failed to load users.', 'error'));
        });
        elements.nextUserPageButton.addEventListener('click', () => {
            if (state.users.page * state.users.perPage >= state.users.total) return;
            state.users.page += 1;
            loadUsers().catch((error) => setStatus(error.message || 'Failed to load users.', 'error'));
        });

        elements.doctorSearchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            state.doctors.q = elements.doctorSearchInput.value.trim();
            state.doctors.verificationStatus = elements.doctorVerificationFilter.value;
            state.doctors.accountStatus = elements.doctorStatusFilter.value;
            state.doctors.page = 1;
            loadDoctors().catch((error) => setStatus(error.message || 'Failed to load doctors.', 'error'));
        });
        elements.prevDoctorPageButton.addEventListener('click', () => {
            if (state.doctors.page <= 1) return;
            state.doctors.page -= 1;
            loadDoctors().catch((error) => setStatus(error.message || 'Failed to load doctors.', 'error'));
        });
        elements.nextDoctorPageButton.addEventListener('click', () => {
            if (state.doctors.page * state.doctors.perPage >= state.doctors.total) return;
            state.doctors.page += 1;
            loadDoctors().catch((error) => setStatus(error.message || 'Failed to load doctors.', 'error'));
        });

        elements.drugSearchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            state.drugs.q = elements.drugSearchInput.value.trim();
            state.drugs.visibility = elements.drugVisibilityFilter.value;
            state.drugs.reviewStatus = elements.drugReviewFilter.value;
            state.drugs.page = 1;
            loadDrugs().catch((error) => setStatus(error.message || 'Failed to load drugs.', 'error'));
        });
        elements.prevDrugPageButton.addEventListener('click', () => {
            if (state.drugs.page <= 1) return;
            state.drugs.page -= 1;
            loadDrugs().catch((error) => setStatus(error.message || 'Failed to load drugs.', 'error'));
        });
        elements.nextDrugPageButton.addEventListener('click', () => {
            if (state.drugs.page * state.drugs.perPage >= state.drugs.total) return;
            state.drugs.page += 1;
            loadDrugs().catch((error) => setStatus(error.message || 'Failed to load drugs.', 'error'));
        });

        elements.issueSearchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            state.issues.q = elements.issueSearchInput.value.trim();
            state.issues.status = elements.issueStatusFilter.value;
            loadIssues().catch((error) => setStatus(error.message || 'Failed to load issues.', 'error'));
        });

        elements.auditSearchForm.addEventListener('submit', (event) => {
            event.preventDefault();
            state.audit.action = elements.auditActionInput.value.trim();
            state.audit.entityType = elements.auditEntityTypeInput.value.trim();
            state.audit.entityId = elements.auditEntityIdInput.value.trim();
            state.audit.page = 1;
            loadAuditEvents().catch((error) => setStatus(error.message || 'Failed to load audit events.', 'error'));
        });
        elements.prevAuditPageButton.addEventListener('click', () => {
            if (state.audit.page <= 1) return;
            state.audit.page -= 1;
            loadAuditEvents().catch((error) => setStatus(error.message || 'Failed to load audit events.', 'error'));
        });
        elements.nextAuditPageButton.addEventListener('click', () => {
            if (state.audit.page * state.audit.perPage >= state.audit.total) return;
            state.audit.page += 1;
            loadAuditEvents().catch((error) => setStatus(error.message || 'Failed to load audit events.', 'error'));
        });

        elements.reasonModalCancel.addEventListener('click', () => closeReasonDialog(null));
        elements.reasonModalForm.addEventListener('submit', (event) => {
            event.preventDefault();
            const value = elements.reasonModalTextarea.value.trim();
            if (reasonModalState?.required && !value) {
                elements.reasonModalError.classList.remove('hidden');
                return;
            }
            closeReasonDialog(value);
        });

        document.addEventListener('change', (event) => {
            const compareInput = event.target.closest('[data-compare-version]');
            if (!compareInput) return;
            const versionNumber = Number(compareInput.dataset.compareVersion);
            const selected = state.drugs.compareVersions.includes(versionNumber);
            if (compareInput.checked && !selected) {
                if (state.drugs.compareVersions.length >= 2) {
                    compareInput.checked = false;
                    setStatus('Select only two versions for compare.', 'error');
                    return;
                }
                state.drugs.compareVersions = [...state.drugs.compareVersions, versionNumber].sort((a, b) => a - b);
            } else if (!compareInput.checked && selected) {
                state.drugs.compareVersions = state.drugs.compareVersions.filter((entry) => entry !== versionNumber);
            }
            renderDrugDetail();
        });

        document.addEventListener('click', (event) => {
            const switchTabButton = event.target.closest('[data-switch-tab]');
            if (switchTabButton) {
                switchTab(switchTabButton.dataset.switchTab);
            }

            const userDetailButton = event.target.closest('[data-user-detail]');
            if (userDetailButton) {
                const userId = Number(userDetailButton.dataset.userDetail);
                loadUserDetail(userId).catch((error) => setStatus(error.message || 'Failed to load user.', 'error'));
                return;
            }

            const userStatusButton = event.target.closest('[data-user-status]');
            if (userStatusButton) {
                updateUserStatus(Number(userStatusButton.dataset.userStatus), userStatusButton.dataset.nextStatus)
                    .catch((error) => setStatus(error.message || 'Failed to update user.', 'error'));
                return;
            }

            const resendButton = event.target.closest('[data-resend-verification]');
            if (resendButton) {
                resendVerification(Number(resendButton.dataset.resendVerification))
                    .catch((error) => setStatus(error.message || 'Failed to resend verification.', 'error'));
                return;
            }

            const doctorDetailButton = event.target.closest('[data-doctor-detail]');
            if (doctorDetailButton) {
                loadDoctorDetail(Number(doctorDetailButton.dataset.doctorDetail))
                    .catch((error) => setStatus(error.message || 'Failed to load doctor.', 'error'));
                return;
            }

            const toggleDoctorButton = event.target.closest('[data-toggle-doctor]');
            if (toggleDoctorButton) {
                toggleDoctorVerification(Number(toggleDoctorButton.dataset.toggleDoctor), toggleDoctorButton.dataset.nextStatus === 'true')
                    .catch((error) => setStatus(error.message || 'Failed to update doctor.', 'error'));
                return;
            }

            const drugDetailButton = event.target.closest('[data-drug-detail]');
            if (drugDetailButton) {
                loadDrugDetail(Number(drugDetailButton.dataset.drugDetail))
                    .catch((error) => setStatus(error.message || 'Failed to load drug.', 'error'));
                return;
            }

            const quickFlagButton = event.target.closest('[data-drug-quick-flag]');
            if (quickFlagButton) {
                quickFlagDrug(
                    Number(quickFlagButton.dataset.drugQuickFlag),
                    quickFlagButton.dataset.flagKind,
                    quickFlagButton.dataset.nextValue
                ).catch((error) => setStatus(error.message || 'Failed to update drug flags.', 'error'));
                return;
            }

            const saveFlagsButton = event.target.closest('[data-save-drug-flags]');
            if (saveFlagsButton) {
                saveDrugFlags(Number(saveFlagsButton.dataset.saveDrugFlags))
                    .catch((error) => setStatus(error.message || 'Failed to update drug flags.', 'error'));
                return;
            }

            const clearCompareButton = event.target.closest('[data-clear-compare]');
            if (clearCompareButton) {
                state.drugs.compareVersions = [];
                renderDrugDetail();
                return;
            }

            const promoteButton = event.target.closest('[data-promote-version]');
            if (promoteButton && !promoteButton.disabled) {
                promoteVersion(Number(promoteButton.dataset.promoteVersion))
                    .catch((error) => setStatus(error.message || 'Failed to promote version.', 'error'));
                return;
            }

            const issueDetailButton = event.target.closest('[data-issue-detail]');
            if (issueDetailButton) {
                loadIssueDetail(Number(issueDetailButton.dataset.issueDetail))
                    .catch((error) => setStatus(error.message || 'Failed to load issue.', 'error'));
                return;
            }

            const closeIssueButton = event.target.closest('[data-close-issue]');
            if (closeIssueButton) {
                closeIssue(Number(closeIssueButton.dataset.closeIssue), closeIssueButton.dataset.withReply === 'true')
                    .catch((error) => setStatus(error.message || 'Failed to close issue.', 'error'));
                return;
            }

            const openIssueDrugButton = event.target.closest('[data-open-issue-drug]');
            if (openIssueDrugButton) {
                openIssueDrug(Number(openIssueDrugButton.dataset.openIssueDrug))
                    .catch((error) => setStatus(error.message || 'Failed to open drug.', 'error'));
            }
        });
    }

    async function init() {
        bindEvents();
        renderOverview();
        renderUsers();
        renderDoctors();
        renderDrugs();
        renderIssues();
        renderAuditEvents();

        if (!state.token) {
            return;
        }

        try {
            await loadCurrentAdmin();
            enterAuthenticatedState();
            await loadOverview();
            setStatus('Admin session restored.');
        } catch (error) {
            leaveAuthenticatedState();
            setStatus(error.message || 'Session expired. Please log in again.', 'error');
        }
    }

    init();
})();
