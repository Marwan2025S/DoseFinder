// Always use relative path — Vite dev server proxies /api to the real backend
import { collectDeviceFingerprint } from '../utils/deviceFingerprint';

const API_BASE = '/api';

// ─── helpers ───────────────────────────────────────────────────────────────────

function getToken() {
    return localStorage.getItem('dms_token');
}

function setToken(token) {
    if (token) localStorage.setItem('dms_token', token);
    else localStorage.removeItem('dms_token');
}

// Registered by AuthContext so auth requests auto-create a guest when no token exists
let _ensureTokenFn = null;
let _pendingEnsureToken = null;

export function registerEnsureToken(fn) {
    _ensureTokenFn = fn;
}

async function ensureAuthToken() {
    const token = getToken();
    if (token) return token;
    if (!_ensureTokenFn) return null;
    if (!_pendingEnsureToken) {
        _pendingEnsureToken = Promise.resolve(_ensureTokenFn()).finally(() => {
            _pendingEnsureToken = null;
        });
    }
    return _pendingEnsureToken;
}

async function withDeviceFingerprint(payload = {}) {
    const deviceFingerprint = await collectDeviceFingerprint();
    return deviceFingerprint
        ? { ...payload, deviceFingerprint }
        : payload;
}

async function request(path, options = {}) {
    const { body, method = body ? 'POST' : 'GET', auth = true, params } = options;
    const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;

    const url = new URL(path.startsWith('http') ? path : `${API_BASE}${path}`, window.location.origin);
    if (params) {
        Object.entries(params).forEach(([k, v]) => {
            if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
        });
    }

    const headers = isFormData ? {} : { 'Content-Type': 'application/json' };
    if (auth) {
        const token = await ensureAuthToken();
        if (token) headers['Authorization'] = `Bearer ${token}`;
    }

    const res = await fetch(url.toString(), {
        method,
        headers,
        body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
    });

    const data = await res.json().catch(() => null);

    if (!res.ok) {
        const message = data?.message || data?.error || `Request failed (${res.status})`;
        const err = new Error(message);
        err.status = res.status;
        err.data = data;
        throw err;
    }

    return data;
}

// ─── Auth ──────────────────────────────────────────────────────────────────────

export const authApi = {
    login: async (credentials) => request('/auth/login', { body: await withDeviceFingerprint(credentials), auth: false }),
    signup: async (userData) => request('/auth/signup', { body: await withDeviceFingerprint(userData), auth: false }),
    googleAuth: async (data) => request('/auth/google', { body: await withDeviceFingerprint(data), auth: false }),
    verifyEmail: (payload) => request('/auth/verify-email', { body: payload, auth: false }),
    resendVerification: (email) => request('/auth/resend-verification', { body: { email }, auth: false }),
    requestPasswordReset: (email) => request('/auth/forgot-password/request', { body: { email }, auth: false }),
    resetPassword: (payload) => request('/auth/forgot-password/reset', { body: payload, auth: false }),
    getMe: () => request('/auth/me'),
    logout: () => request('/auth/logout', { method: 'POST' }),
    createGuest: async () => request('/auth/new-guest', { body: await withDeviceFingerprint(), auth: false }),
    registerGuest: async (data) => request('/auth/register-guest', { body: await withDeviceFingerprint(data), auth: false }),
};

// ─── Drug Data Normalizers ──────────────────────────────────────────────────
// The drug-api now returns the versioned unified schema. The adapter keeps only
// stable UI conveniences such as id, display_name, brand_names_list, and first
// DMS extension fields.

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function parseObjectArray(value) {
    if (Array.isArray(value)) return value.filter((item) => item && typeof item === 'object');
    if (!value) return [];
    if (typeof value === 'object') return [value];
    if (typeof value !== 'string') return [];

    const raw = value.trim();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.filter((item) => item && typeof item === 'object');
        if (parsed && typeof parsed === 'object') return [parsed];
        return [];
    } catch {
        return [];
    }
}

function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    if (typeof value !== 'string') return [];

    const raw = value.trim();
    if (!raw) return [];

    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
        }
        return [String(parsed ?? '').trim()].filter(Boolean);
    } catch {
        return raw
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean);
    }
}

function normalizeHam(value) {
    if (value === 'YES' || value === true || value === 1 || value === '1') return 'YES';
    if (value === 'NO' || value === false || value === 0 || value === '0') return 'NO';
    return value ?? null;
}

function normalizeRxStatus(rxStatus, fallbackRx) {
    if (typeof rxStatus === 'string' && rxStatus.trim()) return rxStatus;
    if (typeof fallbackRx === 'string' && fallbackRx.trim()) return fallbackRx;
    return null;
}

function normalizeDoctorSummary(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;

    const username = typeof value.username === 'string' ? value.username.trim() : '';
    const email = typeof value.email === 'string' ? value.email.trim() : '';
    const id = value.id ?? value.user_id ?? value.userId ?? null;

    return {
        ...value,
        id,
        username: username || null,
        email: email || null,
    };
}

function extractMaximumDose(notesText) {
    if (typeof notesText !== 'string') return null;
    const match = notesText.match(/maximum dose[:\s-]*([^.;]+)/i);
    if (!match?.[1]) return null;
    return `Maximum dose: ${match[1].trim()}`;
}

function normalizeDrug(d) {
    if (!d || typeof d !== 'object') return d;
    const source = d?.data && typeof d.data === 'object' && !Array.isArray(d.data)
        ? d.data
        : d;

    const extensions = asArray(source.drug_dms_extensions).length > 0
        ? asArray(source.drug_dms_extensions)
        : parseObjectArray(source.drug_dms_extensions);
    const extension = extensions[0] ?? {};
    const brandNames = parseStringArray(source.brand_names);

    const rawDosageForms = asArray(source.dosage_forms).length > 0
        ? asArray(source.dosage_forms)
        : parseObjectArray(source.dosage_forms);
    const dosageForms = rawDosageForms.map((item) => ({
        ...item,
        form_name: item?.form_name ?? item?.name ?? '',
        strength_text: item?.strength_text ?? '',
    }));
    const dosageFormLabel = dosageForms[0]?.form_name ?? null;

    const dosing = asArray(source.dosing).map((entry) => ({
        ...entry,
        notes_text: entry?.notes_text ?? entry?.text ?? '',
    }));
    const warnings = asArray(source.warnings).map((entry) => ({
        ...entry,
        text: entry?.text ?? entry?.warning_text ?? '',
    }));
    const adverseEffects = asArray(source.adverse_effects).map((entry) => ({
        ...entry,
        effect_text: entry?.effect_text ?? entry?.reaction_name ?? '',
    }));
    const interactions = asArray(source.interactions).map(normalizeInteraction);
    const pregnancy = asArray(source.pregnancy).map((entry) => ({
        ...entry,
        text: entry?.text ?? '',
    }));
    const pharmacology = asArray(source.pharmacology).map((entry) => ({
        ...entry,
        text: entry?.text ?? '',
    }));
    const administration = asArray(source.administration).map((entry) => ({
        ...entry,
        text: entry?.text ?? '',
    }));
    const suggestedDosing = asArray(source.suggested_dosing).map((entry) => ({
        ...entry,
        notes_text: entry?.notes_text ?? entry?.text ?? '',
    }));
    const suggestedUses = asArray(source.suggested_uses).map((entry) => ({
        ...entry,
        text: entry?.text ?? '',
    }));
    const nutrition = asArray(source.nutrition).map((entry) => ({
        ...entry,
        text: entry?.text ?? '',
    }));

    const fdaProducts = asArray(source.fda_products);
    const fdaSubmissions = asArray(source.fda_submissions);
    const fdaExtensions = asArray(source.fda_extensions);

    const genericName = source.generic_name ?? source.generic ?? null;
    const displayName = genericName ?? brandNames[0] ?? source.name ?? `Drug #${source.drug_id ?? source.id ?? ''}`.trim();
    const ham = normalizeHam(source.ham ?? extension.ham);
    const normalizedRxStatus = normalizeRxStatus(source.rx_status, source.rx);
    const assignedDoctor = normalizeDoctorSummary(
        source.assignedDoctor
        ?? source.assigned_doctor
        ?? source.latestVersionDoctor
        ?? source.latest_version_doctor
        ?? source.doctor
    );

    const normalized = {
        ...source,
        id: source.drug_id ?? source.id ?? source.version_id,
        drug_id: source.drug_id ?? source.id ?? source.version_id,
        display_name: displayName || 'Unknown Drug',
        name: displayName || 'Unknown Drug',
        generic_name: genericName,
        generic: genericName,
        arabic_trade_name: source.arabic_trade_name ?? extension.arabic_trade_name ?? null,
        code: source.code ?? source.version_id ?? source.drug_id ?? source.id ?? null,
        price: source.price ?? extension.price ?? null,
        dosage_form: dosageFormLabel,
        form: dosageFormLabel,
        rx_status: normalizedRxStatus,
        rx: normalizedRxStatus,
        assignedDoctor,
        assigned_doctor: assignedDoctor,
        latestVersionDoctor: assignedDoctor ?? source.latestVersionDoctor ?? null,
        ham,
        note_raw: source.note_raw ?? source.notes ?? extension.notes ?? null,
        notes: source.notes ?? extension.notes ?? null,
        route: source.route ?? extension.route ?? null,
        arabic_route: source.arabic_route ?? extension.arabic_route ?? null,
        brand_names: typeof source.brand_names === 'string' ? source.brand_names : brandNames.join(', '),
        brand_names_list: brandNames,
        drug_dms_extensions: extensions,
        classes: asArray(source.classes),
        subcategory_listing: asArray(source.subcategory_listing),
        dosage_forms: dosageForms,
        dosing,
        warnings,
        adverse_effects: adverseEffects,
        interactions,
        pregnancy,
        pharmacology,
        administration,
        suggested_dosing: suggestedDosing,
        suggested_uses: suggestedUses,
        nutrition,
        fda_products: fdaProducts,
        fda_submissions: fdaSubmissions,
        fda_extensions: fdaExtensions,
        has_fda: Boolean(source.has_fda)
            || fdaProducts.length > 0
            || fdaSubmissions.length > 0
            || fdaExtensions.length > 0,
    };

    if (asArray(source.interaction).length > 0 && interactions.length === 0) {
        normalized.interactions = asArray(source.interaction).map(normalizeInteraction);
    }

    return normalized;
}

function normalizeRoute(r) {
    if (!r || typeof r !== 'object') return r;
    return { ...r, route_name: r.normalized_route ?? r.raw_route ?? r.route_name ?? r.name };
}

function normalizeIndication(ind) {
    if (!ind || typeof ind !== 'object') return ind;
    return { ...ind, indication_name: ind.normalized_indication ?? ind.raw_indication ?? ind.indication_name ?? ind.name };
}

function normalizeInteraction(inter) {
    if (!inter || typeof inter !== 'object') return inter;
    return {
        ...inter,
        drug_name: inter.interacting_drug ?? inter.interactant_canonical ?? inter.raw_drug_interactions ?? inter.drug_name ?? inter.name ?? '',
        qualifier: inter.qualifier ?? inter.severity_level ?? null,
        description: inter.description ?? inter.text ?? null,
    };
}

function normalizeAdverseReaction(ar) {
    if (!ar || typeof ar !== 'object') return ar;
    const severityText = String(ar.severity_band ?? ar.severity ?? '').toLowerCase();
    return {
        ...ar,
        reaction_name: ar.effect_text ?? ar.reaction_normalized ?? ar.raw_adverse_reactions ?? ar.reaction_name ?? '',
        is_severe: ar.is_severe ?? /severe|serious|major/.test(severityText),
    };
}

function normalizeSavedDrug(savedDrug) {
    if (!savedDrug) return savedDrug;
    const normalized = normalizeDrug(savedDrug);
    return {
        ...normalized,
        id: savedDrug.drug_id ?? normalized.id,
        drug_id: savedDrug.drug_id ?? normalized.id,
        saved_at: savedDrug.saved_at ?? savedDrug.savedAt ?? savedDrug.created_at ?? null,
    };
}

function normalizeProfile(profile) {
    if (!profile || typeof profile !== 'object') return profile;
    return {
        ...profile,
        displayName: profile.displayName ?? profile.display_name ?? profile.username ?? null,
    };
}

// ─── Profile ───────────────────────────────────────────────────────────────────

export const profileApi = {
    getProfile: () =>
        request('/profile/').then((res) => ({
            ...res,
            data: normalizeProfile(res?.data),
        })),
    updateProfile: ({ username, displayName }) =>
        request('/profile/', {
            method: 'PUT',
            body: { username, displayName },
        }).then((res) => ({
            ...res,
            data: normalizeProfile(res?.data),
        })),
    changePassword: ({ currentPassword, newPassword }) =>
        request('/profile/password', {
            method: 'PUT',
            body: { currentPassword, newPassword },
        }),
    createPassword: ({ newPassword }) =>
        request('/profile/password/create', {
            method: 'POST',
            body: { newPassword },
        }),
    requestEmailChange: ({ newEmail, currentPassword }) =>
        request('/profile/email/request', {
            method: 'POST',
            body: { newEmail, currentPassword },
        }),
    confirmEmailChange: ({ otp }) =>
        request('/profile/email/confirm', {
            method: 'POST',
            body: { otp },
        }).then((res) => ({
            ...res,
            data: normalizeProfile(res?.data),
        })),
    getSearchHistory: (limit) => request('/profile/search-history', {
        method: 'GET',
        params: {
            limit,
        },
    }),
    removeSearchHistoryItem: (historyId) =>
        request(`/profile/search-history/${historyId}`, { method: 'DELETE' }),
    getSavedDrugs: () =>
        request('/profile/saved-drugs').then((res) => ({
            ...res,
            data: Array.isArray(res?.data) ? res.data.map(normalizeSavedDrug) : [],
        })),
    saveDrug: (drugId) =>
        request('/profile/saved-drugs', { body: { drugId } }).then((res) => ({
            ...res,
            data: res?.data
                ? {
                    ...res.data,
                    drug: normalizeSavedDrug(res.data.drug),
                }
                : res.data,
        })),
    removeSavedDrug: (drugId) => request(`/profile/saved-drugs/${drugId}`, { method: 'DELETE' }),
    clearSavedDrugs: () => request('/profile/saved-drugs', { method: 'DELETE' }),
};

// ─── Dashboard ─────────────────────────────────────────────────────────────────

export const dashboardApi = {
    getDoctorSummary: () =>
        request('/dashboard/doctor').then((res) => {
            const data = res?.data ?? res;
            return {
                ...data,
                openIssues: Array.isArray(data?.openIssues) ? data.openIssues : [],
                needsReviewDrugs: Array.isArray(data?.needsReviewDrugs)
                    ? data.needsReviewDrugs.map(normalizeDrug)
                    : [],
                recentDrugs: Array.isArray(data?.recentDrugs)
                    ? data.recentDrugs.map(normalizeDrug)
                    : [],
                metrics: {
                    openIssues: Number(data?.metrics?.openIssues || 0),
                    needsReviewDrugs: Number(data?.metrics?.needsReviewDrugs || 0),
                    visibleDrugs: Number(data?.metrics?.visibleDrugs || 0),
                    updatedThisWeek: Number(data?.metrics?.updatedThisWeek || 0),
                },
            };
        }),
};

// ─── Issues ────────────────────────────────────────────────────────────────────

export const issuesApi = {
    create: (payload) =>
        request('/issues', { body: payload }).then((res) => res?.data ?? res),
    getMine: (drugId) =>
        request('/issues/mine', {
            method: 'GET',
            params: { drugId },
        }).then((res) => (Array.isArray(res?.data) ? res.data : [])),
    list: (filters = {}) =>
        request('/issues', {
            method: 'GET',
            params: {
                status: filters.status,
                q: filters.q,
                page: filters.page,
                per_page: filters.per_page,
            },
        }).then((res) => res?.data ?? { issues: [], total: 0, page: 1, perPage: 20 }),
    getDetails: (issueId) =>
        request(`/issues/${issueId}`).then((res) => res?.data ?? res),
    close: (issueId, payload = {}) =>
        request(`/issues/${issueId}/close`, { body: payload }).then((res) => res?.data ?? res),
    fix: (issueId, payload) =>
        request(`/issues/${issueId}/fix`, { body: payload }).then((res) => res?.data ?? res),
};

// ─── Drugs ─────────────────────────────────────────────────────────────────────

export const drugsApi = {
    search: (filters = {}) =>
        request('/drugs/search', {
            method: 'GET',
            params: {
                q: filters.q,
                dosage_form: filters.dosage_form,
                route: filters.route,
                indication: filters.indication,
                min_price: filters.min_price,
                max_price: filters.max_price,
                sort_by: filters.sort_by,
                sort_order: filters.sort_order,
                has_fda: filters.has_fda,
                page: filters.page,
                per_page: filters.per_page,
                include_doctor: filters.include_doctor,
            },
        }).then(res => ({
            ...res,
            results: (res?.results || []).map(normalizeDrug),
        })),
    getDetails: (drugId) =>
        request(`/drugs/${drugId}`).then(normalizeDrug),
    getRoutes: (drugId) =>
        request(`/drugs/${drugId}/routes`).then(arr =>
            (Array.isArray(arr) ? arr : []).map(normalizeRoute)),
    getIndications: (drugId) =>
        request(`/drugs/${drugId}/indications`).then(arr =>
            (Array.isArray(arr) ? arr : []).map(normalizeIndication)),
    getInteractions: (drugId) =>
        request(`/drugs/${drugId}/interactions`).then(arr =>
            (Array.isArray(arr) ? arr : []).map(normalizeInteraction)),
    create: (payload) =>
        request('/drugs', { method: 'POST', body: payload }).then(normalizeDrug),
    update: (drugId, payload) =>
        request(`/drugs/${drugId}`, { method: 'PUT', body: payload }).then(normalizeDrug),
    updateVisibility: (drugId, { visibility, reason }) =>
        request(`/drugs/${drugId}/visibility`, { method: 'PATCH', body: { visibility, reason } }).then((res) => res?.data ?? res),
    extractText: (text) =>
        request('/drugs/extract', { method: 'POST', body: { text } }).then((res) => res?.data ?? res),
    extractFile: (file) => {
        const formData = new FormData();
        formData.append('file', file);
        return request('/drugs/extract-file', { method: 'POST', body: formData }).then((res) => res?.data ?? res);
    },
};

// ─── AI Chat ───────────────────────────────────────────────────────────────────

export const aiApi = {
    newChat: (title) => request('/ai/new-chat', { body: title ? { title } : {} }),
    sendTemporaryMessage: (messages) =>
        request('/ai/temporary-message', { body: { messages } }),
    getConversations: (page, limit, q) =>
        request('/ai/conversations', { method: 'GET', params: { page, limit, q } }),
    searchConversations: (q, page = 1, limit = 50) =>
        request('/ai/conversations', { method: 'GET', params: { page, limit, q } }),
    getMessages: (conversationId, page, limit) =>
        request(`/ai/conversations/${conversationId}/messages`, {
            method: 'GET',
            params: { page, limit },
        }),
    sendMessage: (conversationId, content) =>
        request(`/ai/conversations/${conversationId}/message`, { body: { content } }),
    shareConversation: (conversationId) =>
        request(`/ai/conversations/${conversationId}/share`, { method: 'POST' }),
    getSharedChat: (token) =>
        request(`/ai/shared-chats/${token}`, { method: 'GET', auth: false }),
    updateTitle: (conversationId, title) =>
        request(`/ai/conversations/${conversationId}/title`, {
            method: 'PUT',
            body: { title },
        }),
    deleteConversation: (conversationId) =>
        request(`/ai/conversations/${conversationId}`, { method: 'DELETE' }),
};

// ─── Health ────────────────────────────────────────────────────────────────────

export const healthApi = {
    check: () => request('/health', { auth: false }),
};

// Re-export token helpers for use by AuthContext
export { getToken, setToken };
