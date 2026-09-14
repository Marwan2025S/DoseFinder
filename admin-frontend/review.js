(function () {
    const ADMIN_TOKEN_KEY = 'dms_admin_token';
    const INTERNAL_META_KEYS = new Set(['id', 'version_id', 'drug_id', 'updated_at', 'is_current', 'is_deleted', 'deleted_at']);
    const HIDDEN_SECTION_KEYS = new Set(['fda_ids', 'fda_payload_hashes']);
    const IGNORED_COMPARE_KEYS = new Set(['version_id', 'version_number', 'updated_at', 'is_deleted', 'deleted_at']);
    const SCALAR_FIELD_ORDER = [
        'drug_id',
        'version_id',
        'version_number',
        'updated_at',
        'is_current',
        'is_deleted',
        'deleted_at',
        'doctor_id',
        'generic_name',
        'brand_names',
        'rx_status',
        'source',
        'url',
    ];
    const SECTION_ORDER = [
        'dosage_forms',
        'dosing',
        'adverse_effects',
        'warnings',
        'interactions',
        'pregnancy',
        'pharmacology',
        'administration',
        'suggested_dosing',
        'suggested_uses',
        'nutrition',
        'drug_dms_extensions',
        'classes',
        'subcategory_listing',
        'fda_products',
        'fda_submissions',
        'fda_extensions',
    ];
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
        drugId: null,
        versionNumber: null,
        compareVersions: [],
        detail: null,
        compare: [],
        showRawCompareJson: false,
    };

    const elements = {
        currentAdminName: document.getElementById('currentAdminName'),
        logoutButton: document.getElementById('logoutButton'),
        statusBanner: document.getElementById('statusBanner'),
        reviewTitle: document.getElementById('reviewTitle'),
        reviewSummary: document.getElementById('reviewSummary'),
        reviewMeta: document.getElementById('reviewMeta'),
        reviewContent: document.getElementById('reviewContent'),
        toggleRawJsonButton: document.getElementById('toggleRawJsonButton'),
    };

    function getApiBases() {
        return Array.from(new Set(defaultApiBases));
    }

    function isPlainObject(value) {
        return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
    }

    function escapeHtml(value) {
        return String(value)
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

    function setStatus(message, tone) {
        if (!message) {
            elements.statusBanner.textContent = '';
            elements.statusBanner.className = 'status-banner hidden';
            return;
        }

        elements.statusBanner.textContent = message;
        elements.statusBanner.className = `status-banner status-banner--${tone || 'success'}`;
    }

    function setToken(token) {
        state.token = token || null;
        if (token) {
            window.localStorage.setItem(ADMIN_TOKEN_KEY, token);
            return;
        }

        window.localStorage.removeItem(ADMIN_TOKEN_KEY);
    }

    async function apiRequest(path, options) {
        const config = options || {};
        let lastError = null;

        for (const base of getApiBases()) {
            const url = new URL(`${base}${path}`);
            const headers = { Accept: 'application/json' };

            if (config.params) {
                Object.entries(config.params).forEach(([key, value]) => {
                    if (value !== undefined && value !== null && value !== '') {
                        url.searchParams.set(key, value);
                    }
                });
            }

            if (config.tokenOverride || state.token) {
                headers.Authorization = `Bearer ${config.tokenOverride || state.token}`;
            }

            if (config.body !== undefined) {
                headers['Content-Type'] = 'application/json';
            }

            try {
                const response = await window.fetch(url.toString(), {
                    method: config.method || (config.body !== undefined ? 'POST' : 'GET'),
                    headers,
                    body: config.body !== undefined ? JSON.stringify(config.body) : undefined,
                });

                const payload = await response.json().catch(() => null);
                if (!response.ok) {
                    const error = new Error(payload?.message || payload?.error || `Request failed (${response.status})`);
                    error.status = response.status;
                    throw error;
                }

                return payload;
            } catch (error) {
                if (error?.status) {
                    throw error;
                }

                lastError = error;
            }
        }

        throw new Error(lastError?.message || 'Unable to reach the backend API. Check whether the backend is running.');
    }

    function normalizePositiveInt(value) {
        const parsed = Number.parseInt(value, 10);
        return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
    }

    function parseCompareVersions(value) {
        if (!value) {
            return [];
        }

        const versions = value
            .split(',')
            .map((part) => normalizePositiveInt(part))
            .filter((part) => part !== null);

        return Array.from(new Set(versions)).sort((left, right) => left - right);
    }

    function formatVersionTag(versionNumber) {
        const normalized = normalizePositiveInt(versionNumber) || 1;
        return `v${normalized}`;
    }

    function isIgnoredCompareKey(key) {
        if (key === null || key === undefined) {
            return false;
        }

        const text = String(key);
        return (
            text === 'id'
            || text.endsWith('_id')
            || text.endsWith('Id')
            || text === 'version_number'
            || text === 'versionNumber'
            || text === 'updated_at'
        );
    }

    function isIgnoredCompareField(key) {
        return IGNORED_COMPARE_KEYS.has(key) || isIgnoredCompareKey(key);
    }

    function humanizeKey(key) {
        const labels = {
            drug_id: 'Drug ID',
            version_id: 'Version ID',
            version_number: 'Version number',
            updated_at: 'Updated at',
            is_current: 'Is current',
            is_deleted: 'Is deleted',
            deleted_at: 'Deleted at',
            doctor_id: 'Doctor ID',
            generic_name: 'Generic name',
            brand_names: 'Brand names',
            rx_status: 'Rx status',
            classes: 'Classes',
            dosage_forms: 'Dosage forms',
            adverse_effects: 'Adverse effects',
            suggested_dosing: 'Suggested dosing',
            suggested_uses: 'Suggested uses',
            drug_dms_extensions: 'DMS extensions',
            subcategory_listing: 'Subcategory listing',
            fda_products: 'FDA products',
            fda_submissions: 'FDA submissions',
            fda_extensions: 'FDA marketing',
            arabic_trade_name: 'Arabic trade name',
            arabic_route: 'Arabic route',
        };

        if (labels[key]) {
            return labels[key];
        }

        return String(key)
            .replace(/_/g, ' ')
            .replace(/\b\w/g, (character) => character.toUpperCase());
    }

    function formatValue(value) {
        if (value === null || value === undefined || value === '') {
            return 'None';
        }

        if (typeof value === 'boolean') {
            return value ? 'Yes' : 'No';
        }

        if (typeof value === 'number') {
            return String(value);
        }

        if (typeof value === 'string') {
            return value;
        }

        return JSON.stringify(value, null, 2);
    }

    function formatDoctorLabel(doctor) {
        if (!doctor) {
            return 'System';
        }

        return doctor.username || doctor.email || (doctor.id ? `Doctor #${doctor.id}` : 'System');
    }

    function formatDoctorSubline(doctor) {
        if (!doctor) {
            return 'Auto-generated or unresolved doctor.';
        }

        if (doctor.email) {
            return doctor.email;
        }

        if (doctor.id) {
            return `ID ${doctor.id}`;
        }

        return 'Auto-generated or unresolved doctor.';
    }

    function parseBrandNames(value) {
        if (Array.isArray(value)) {
            return value.filter(Boolean);
        }

        if (typeof value !== 'string') {
            return [];
        }

        try {
            const parsed = JSON.parse(value);
            return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
        } catch (error) {
            return value.trim() ? [value.trim()] : [];
        }
    }

    function getDrugTitleFromSnapshot(snapshot) {
        const brandNames = parseBrandNames(snapshot?.brand_names);
        return snapshot?.generic_name
            || snapshot?.display_name
            || snapshot?.name
            || brandNames[0]
            || (snapshot?.drug_id ? `Drug #${snapshot.drug_id}` : 'Drug review');
    }

    function getDrugSubtitle(snapshot) {
        const brandNames = parseBrandNames(snapshot?.brand_names);
        if (brandNames.length) {
            return brandNames.join(', ');
        }

        return snapshot?.source || `Drug #${snapshot?.drug_id || state.drugId || 'Unknown'}`;
    }

    function renderEmptyContent(message) {
        return `<div class="inspector-empty">${escapeHtml(message)}</div>`;
    }

    function toStableValue(value) {
        if (Array.isArray(value)) {
            return value.map((item) => toStableValue(item));
        }

        if (isPlainObject(value)) {
            return Object.keys(value)
                .sort((left, right) => left.localeCompare(right))
                .reduce((result, key) => {
                    result[key] = toStableValue(value[key]);
                    return result;
                }, {});
        }

        return value;
    }

    function stableStringify(value) {
        return JSON.stringify(toStableValue(value));
    }

    function normalizeDiffValue(value) {
        if (Array.isArray(value)) {
            return value.map((item) => normalizeDiffValue(item));
        }

        if (isPlainObject(value)) {
            return Object.keys(value).reduce((result, key) => {
                if (INTERNAL_META_KEYS.has(key) || isIgnoredCompareField(key)) {
                    return result;
                }
                if (HIDDEN_SECTION_KEYS.has(key)) {
                    return result;
                }
                result[key] = normalizeDiffValue(value[key]);
                return result;
            }, {});
        }

        return value;
    }

    function omitIgnoredCompareKeys(value) {
        if (Array.isArray(value)) {
            return value.map((item) => omitIgnoredCompareKeys(item));
        }

        if (isPlainObject(value)) {
            return Object.entries(value).reduce((result, [key, entryValue]) => {
                if (isIgnoredCompareField(key) || HIDDEN_SECTION_KEYS.has(key)) {
                    return result;
                }

                result[key] = omitIgnoredCompareKeys(entryValue);
                return result;
            }, {});
        }

        return value;
    }

    function areValuesEqual(leftValue, rightValue) {
        return stableStringify(normalizeDiffValue(leftValue)) === stableStringify(normalizeDiffValue(rightValue));
    }

    function compareFieldOrder(leftKey, rightKey, preferredOrder) {
        const leftIndex = preferredOrder.indexOf(leftKey);
        const rightIndex = preferredOrder.indexOf(rightKey);

        if (leftIndex !== -1 || rightIndex !== -1) {
            if (leftIndex === -1) return 1;
            if (rightIndex === -1) return -1;
            return leftIndex - rightIndex;
        }

        return leftKey.localeCompare(rightKey);
    }

    function getScalarEntries(snapshot) {
        return Object.entries(snapshot || {})
            .filter(([, value]) => !Array.isArray(value))
            .sort(([leftKey], [rightKey]) => compareFieldOrder(leftKey, rightKey, SCALAR_FIELD_ORDER));
    }

    function getSectionEntries(snapshot) {
        return Object.entries(snapshot || {})
            .filter(([, value]) => Array.isArray(value))
            .filter(([key]) => !HIDDEN_SECTION_KEYS.has(key))
            .sort(([leftKey], [rightKey]) => compareFieldOrder(leftKey, rightKey, SECTION_ORDER));
    }

    function getCompareScalarKeys(snapshot, otherSnapshot) {
        return Array.from(new Set([
            ...getScalarEntries(snapshot).map(([key]) => key),
            ...getScalarEntries(otherSnapshot).map(([key]) => key),
        ])).sort((leftKey, rightKey) => compareFieldOrder(leftKey, rightKey, SCALAR_FIELD_ORDER));
    }

    function getCompareSectionKeys(snapshot, otherSnapshot) {
        return Array.from(new Set([
            ...getSectionEntries(snapshot).map(([key]) => key),
            ...getSectionEntries(otherSnapshot).map(([key]) => key),
        ])).sort((leftKey, rightKey) => compareFieldOrder(leftKey, rightKey, SECTION_ORDER));
    }

    function getVisibleRowEntries(row) {
        const normalized = normalizeDiffValue(row || {});
        return Object.entries(normalized).sort(([leftKey], [rightKey]) => leftKey.localeCompare(rightKey));
    }

    function alignSectionRows(leftRows, rightRows) {
        const leftList = Array.isArray(leftRows) ? leftRows : [];
        const rightList = Array.isArray(rightRows) ? rightRows : [];
        const leftSignatures = leftList.map((row) => stableStringify(normalizeDiffValue(row)));
        const rightSignatures = rightList.map((row) => stableStringify(normalizeDiffValue(row)));
        const leftCount = leftSignatures.length;
        const rightCount = rightSignatures.length;
        const matrix = Array.from({ length: leftCount + 1 }, () => Array(rightCount + 1).fill(0));

        for (let leftIndex = leftCount - 1; leftIndex >= 0; leftIndex -= 1) {
            for (let rightIndex = rightCount - 1; rightIndex >= 0; rightIndex -= 1) {
                if (leftSignatures[leftIndex] === rightSignatures[rightIndex]) {
                    matrix[leftIndex][rightIndex] = matrix[leftIndex + 1][rightIndex + 1] + 1;
                } else {
                    matrix[leftIndex][rightIndex] = Math.max(
                        matrix[leftIndex + 1][rightIndex],
                        matrix[leftIndex][rightIndex + 1]
                    );
                }
            }
        }

        const alignment = [];
        let leftIndex = 0;
        let rightIndex = 0;

        while (leftIndex < leftCount || rightIndex < rightCount) {
            if (
                leftIndex < leftCount
                && rightIndex < rightCount
                && leftSignatures[leftIndex] === rightSignatures[rightIndex]
            ) {
                alignment.push({
                    left: leftList[leftIndex],
                    right: rightList[rightIndex],
                    changed: false,
                });
                leftIndex += 1;
                rightIndex += 1;
                continue;
            }

            if (
                rightIndex < rightCount
                && (leftIndex === leftCount || matrix[leftIndex][rightIndex + 1] >= matrix[leftIndex + 1][rightIndex])
            ) {
                alignment.push({
                    left: null,
                    right: rightList[rightIndex],
                    changed: true,
                });
                rightIndex += 1;
                continue;
            }

            alignment.push({
                left: leftList[leftIndex] || null,
                right: null,
                changed: true,
            });
            leftIndex += 1;
        }

        return alignment;
    }

    function stringifyJsonForCompare(value) {
        const json = JSON.stringify(value, null, 2);
        return typeof json === 'string' ? json : 'null';
    }

    function getMatchingJsonLineIndexes(leftValue, rightValue) {
        const leftLines = stringifyJsonForCompare(leftValue).split('\n');
        const rightLines = stringifyJsonForCompare(rightValue).split('\n');
        const leftCount = leftLines.length;
        const rightCount = rightLines.length;
        const matrix = Array.from({ length: leftCount + 1 }, () => Array(rightCount + 1).fill(0));

        for (let leftIndex = leftCount - 1; leftIndex >= 0; leftIndex -= 1) {
            for (let rightIndex = rightCount - 1; rightIndex >= 0; rightIndex -= 1) {
                if (leftLines[leftIndex] === rightLines[rightIndex]) {
                    matrix[leftIndex][rightIndex] = matrix[leftIndex + 1][rightIndex + 1] + 1;
                } else {
                    matrix[leftIndex][rightIndex] = Math.max(
                        matrix[leftIndex + 1][rightIndex],
                        matrix[leftIndex][rightIndex + 1]
                    );
                }
            }
        }

        const leftMatches = new Set();
        const rightMatches = new Set();
        let leftIndex = 0;
        let rightIndex = 0;

        while (leftIndex < leftCount && rightIndex < rightCount) {
            if (leftLines[leftIndex] === rightLines[rightIndex]) {
                leftMatches.add(leftIndex);
                rightMatches.add(rightIndex);
                leftIndex += 1;
                rightIndex += 1;
                continue;
            }

            if (matrix[leftIndex][rightIndex + 1] >= matrix[leftIndex + 1][rightIndex]) {
                rightIndex += 1;
            } else {
                leftIndex += 1;
            }
        }

        return {
            leftLines,
            rightLines,
            leftMatches,
            rightMatches,
        };
    }

    function renderJsonDiffLines(lines, matchingIndexes) {
        return lines.map((line, index) => {
            const classes = ['json-diff__line'];
            const changed = !matchingIndexes.has(index);
            if (!matchingIndexes.has(index)) {
                classes.push('json-diff__line--changed');
            }

            return `<span class="${classes.join(' ')}"><span class="json-diff__marker">${changed ? '!' : '&nbsp;'}</span><span class="json-diff__text">${line ? escapeHtml(line) : '&nbsp;'}</span></span>`;
        }).join('');
    }

    function renderScalarField(key, value, changed, muted, ignored) {
        const classes = ['inspector-field'];
        if (changed) classes.push('inspector-field--changed');
        if (muted) classes.push('inspector-field--muted');
        if (ignored) classes.push('inspector-field--ignored');

        return `
            <div class="${classes.join(' ')}">
                <span class="inspector-field__label">
                    ${escapeHtml(humanizeKey(key))}
                    ${ignored ? '<span class="inspector-field__flag">Ignored update</span>' : ''}
                </span>
                <div class="inspector-field__value">${escapeHtml(formatValue(value))}</div>
            </div>
        `;
    }

    function renderRowCard(row, changed, muted, missingMessage, statusLabel) {
        const classes = ['row-card'];
        if (changed) classes.push('row-card--changed');
        if (muted) classes.push('row-card--muted');

        if (!row) {
            classes.push('row-card--missing');
            return `
                <article class="${classes.join(' ')}">
                    <div class="row-card__missing">${escapeHtml(missingMessage || 'Not present')}</div>
                </article>
            `;
        }

        const entries = getVisibleRowEntries(row);
        const statusMarkup = statusLabel
            ? `<div class="row-card__status">${escapeHtml(statusLabel)}</div>`
            : '';
        const fieldsMarkup = entries.length
            ? entries.map(([key, value]) => `
                <div class="row-card__field">
                    <span class="row-card__label">${escapeHtml(humanizeKey(key))}</span>
                    <div class="row-card__value">${escapeHtml(formatValue(value))}</div>
                </div>
            `).join('')
            : '<div class="row-card__value">No visible fields in this row.</div>';

        return `
            <article class="${classes.join(' ')}">
                ${statusMarkup}
                <div class="row-card__fields">${fieldsMarkup}</div>
            </article>
        `;
    }

    function renderSectionList(rows, emptyMessage) {
        if (!rows.length) {
            return `<div class="empty-state">${escapeHtml(emptyMessage)}</div>`;
        }

        return `
            <div class="row-list">
                ${rows.map((row, index) => `
                    <div>
                        <span class="row-card__index">Row ${index + 1}</span>
                        ${renderRowCard(row, false, false, 'No row data.')}
                    </div>
                `).join('')}
            </div>
        `;
    }

    function renderCompareSectionPairs(alignment, leftVersionLabel, rightVersionLabel) {
        if (!alignment.length) {
            return '<div class="empty-state">No rows stored for this section.</div>';
        }

        return `
            <div class="compare-section-list">
                ${alignment.map((entry, index) => {
                    return `
                        <div class="compare-row-pair">
                            <div class="compare-row-pair__cell">
                                <span class="row-card__index">${escapeHtml(`${leftVersionLabel} · Row ${index + 1}`)}</span>
                                ${renderRowCard(entry.left, entry.changed, !entry.changed, `Missing in ${leftVersionLabel}.`)}
                            </div>
                            <div class="compare-row-pair__cell">
                                <span class="row-card__index">${escapeHtml(`${rightVersionLabel} · Row ${index + 1}`)}</span>
                                ${renderRowCard(entry.right, entry.changed, !entry.changed, `Missing in ${rightVersionLabel}.`)}
                            </div>
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    }

    function renderSharedCompareSections(leftDetail, rightDetail) {
        const leftSnapshot = leftDetail?.version || {};
        const rightSnapshot = rightDetail?.version || {};
        const leftVersionLabel = formatVersionTag(leftDetail?.versionNumber || leftSnapshot.version_number || 1);
        const rightVersionLabel = formatVersionTag(rightDetail?.versionNumber || rightSnapshot.version_number || 1);
        const sectionKeys = getCompareSectionKeys(leftSnapshot, rightSnapshot);

        if (!sectionKeys.length) {
            return '<div class="empty-state">No section data found in these snapshots.</div>';
        }

        return `
            <div class="compare-sections">
                ${sectionKeys.map((key) => {
                    const alignment = alignSectionRows(leftSnapshot[key], rightSnapshot[key]);
                    return `
                        <section class="inspector-section">
                            <h3>${escapeHtml(humanizeKey(key))}</h3>
                            ${renderCompareSectionPairs(alignment, leftVersionLabel, rightVersionLabel)}
                        </section>
                    `;
                }).join('')}
            </div>
        `;
    }

    function buildVersionMeta(detail) {
        const doctor = detail?.doctor || null;
        const snapshot = detail?.version || {};
        const sectionCount = getSectionEntries(snapshot).length;
        const fieldCount = getScalarEntries(snapshot).length;

        return `
            <div class="inspector-head">
                <section class="inspector-card">
                    <h3>Version</h3>
                    <div class="inspector-card__meta">
                        <div>${escapeHtml(formatVersionTag(detail?.versionNumber || snapshot.version_number || 1))}</div>
                        <div>${snapshot.is_current ? 'Currently live' : 'Historical snapshot'}</div>
                        <div>Updated ${escapeHtml(formatDate(snapshot.updated_at))}</div>
                    </div>
                </section>
                <section class="inspector-card">
                    <h3>Doctor</h3>
                    <div class="inspector-card__meta">
                        <div>${escapeHtml(formatDoctorLabel(doctor))}</div>
                        <div>${escapeHtml(formatDoctorSubline(doctor))}</div>
                    </div>
                </section>
                <section class="inspector-card">
                    <h3>Snapshot</h3>
                    <div class="inspector-card__meta">
                        <div>Drug ID ${escapeHtml(String(detail?.drugId || snapshot.drug_id || state.drugId || 'Unknown'))}</div>
                        <div>${escapeHtml(`${sectionCount} section${sectionCount === 1 ? '' : 's'}`)}</div>
                        <div>${escapeHtml(`${fieldCount} scalar field${fieldCount === 1 ? '' : 's'}`)}</div>
                    </div>
                </section>
            </div>
        `;
    }

    function renderVersionDetail(detail) {
        const snapshot = detail?.version || {};
        const scalarMarkup = getScalarEntries(snapshot)
            .map(([key, value]) => renderScalarField(key, value, false, false))
            .join('');
        const sectionsMarkup = getSectionEntries(snapshot)
            .map(([key, rows]) => `
                <section class="inspector-section">
                    <h3>${escapeHtml(humanizeKey(key))}</h3>
                    ${renderSectionList(rows, 'No rows stored in this section.')}
                </section>
            `)
            .join('');

        return `
            <div class="inspector-stack">
                ${buildVersionMeta(detail)}
                <section class="inspector-section">
                    <h3>Snapshot fields</h3>
                    ${scalarMarkup ? `<div class="inspector-fields">${scalarMarkup}</div>` : '<div class="empty-state">No scalar fields found in this snapshot.</div>'}
                </section>
                ${sectionsMarkup || '<div class="empty-state">No section data found in this snapshot.</div>'}
            </div>
        `;
    }

    function buildCompareColumn(detail, otherDetail, options) {
        const snapshot = detail?.version || {};
        const otherSnapshot = otherDetail?.version || {};
        const includeSections = options?.includeSections !== false;
        const scalarKeys = getCompareScalarKeys(snapshot, otherSnapshot);
        const scalarMarkup = scalarKeys.map((key) => {
            const value = snapshot[key];
            const differs = !areValuesEqual(snapshot[key], otherSnapshot[key]);
            const ignored = differs && isIgnoredCompareField(key);
            const changed = differs && !ignored;
            return renderScalarField(key, value, changed, !changed, ignored);
        }).join('');
        const sectionsMarkup = includeSections
            ? getCompareSectionKeys(snapshot, otherSnapshot).map((key) => {
                const alignment = alignSectionRows(snapshot[key], otherSnapshot[key]);
                const currentVersionLabel = formatVersionTag(detail?.versionNumber || snapshot.version_number || 1);
                const otherVersionLabel = formatVersionTag(otherDetail?.versionNumber || otherSnapshot.version_number || 1);
                return `
                    <section class="inspector-section">
                        <h3>${escapeHtml(humanizeKey(key))}</h3>
                        ${renderCompareSectionPairs(
                            alignment,
                            currentVersionLabel,
                            otherVersionLabel
                        )}
                    </section>
                `;
            }).join('')
            : '';

        return `
            <section class="compare-column">
                <h3>${escapeHtml(`Version ${detail?.versionNumber || snapshot.version_number || 'Unknown'}`)}</h3>
                <div class="compare-column__meta">
                    <div>${snapshot.is_current ? 'Currently live' : 'Historical snapshot'}</div>
                    <div>Updated ${escapeHtml(formatDate(snapshot.updated_at))}</div>
                    <div>Doctor: ${escapeHtml(formatDoctorLabel(detail?.doctor))}</div>
                </div>
                <section class="inspector-section">
                    <h3>Snapshot fields</h3>
                    ${scalarMarkup ? `<div class="inspector-fields">${scalarMarkup}</div>` : '<div class="empty-state">No scalar fields found in this snapshot.</div>'}
                </section>
                ${includeSections ? (sectionsMarkup || '<div class="empty-state">No section data found in this snapshot.</div>') : ''}
            </section>
        `;
    }

    function renderVersionCompare(compareDetails) {
        const [leftDetail, rightDetail] = compareDetails;
        return `
            <div class="compare-stack">
                <div class="compare-grid">
                    ${buildCompareColumn(leftDetail, rightDetail, { includeSections: false })}
                    ${buildCompareColumn(rightDetail, leftDetail, { includeSections: false })}
                </div>
                ${renderSharedCompareSections(leftDetail, rightDetail)}
            </div>
        `;
    }

    function renderCompareJson(compareDetails) {
        const [leftDetail, rightDetail] = compareDetails.map((detail) => omitIgnoredCompareKeys(detail));
        const diff = getMatchingJsonLineIndexes(leftDetail, rightDetail);

        return `
            <div class="compare-json-grid">
                <section class="compare-column compare-column--json">
                    <h3>${escapeHtml(`Version ${leftDetail.versionNumber}`)}</h3>
                    <div class="compare-column__meta">
                        <div>Doctor: ${escapeHtml(formatDoctorLabel(leftDetail.doctor))}</div>
                        <div>Updated ${escapeHtml(formatDate(leftDetail.version?.updated_at))}</div>
                    </div>
                    <pre class="json-diff">${renderJsonDiffLines(diff.leftLines, diff.leftMatches)}</pre>
                </section>
                <section class="compare-column compare-column--json">
                    <h3>${escapeHtml(`Version ${rightDetail.versionNumber}`)}</h3>
                    <div class="compare-column__meta">
                        <div>Doctor: ${escapeHtml(formatDoctorLabel(rightDetail.doctor))}</div>
                        <div>Updated ${escapeHtml(formatDate(rightDetail.version?.updated_at))}</div>
                    </div>
                    <pre class="json-diff">${renderJsonDiffLines(diff.rightLines, diff.rightMatches)}</pre>
                </section>
            </div>
        `;
    }

    function updateRawJsonToggle(isVisible) {
        if (!elements.toggleRawJsonButton) {
            return;
        }

        elements.toggleRawJsonButton.classList.toggle('hidden', !isVisible);
        if (isVisible) {
            elements.toggleRawJsonButton.textContent = state.showRawCompareJson
                ? 'Show highlighted compare'
                : 'Show raw JSON';
        }
    }

    function renderInvalidRequest(message) {
        updateRawJsonToggle(false);
        elements.reviewTitle.textContent = 'Review unavailable';
        elements.reviewSummary.textContent = 'Choose a version or comparison from the admin dashboard.';
        elements.reviewMeta.textContent = message;
        elements.reviewContent.innerHTML = renderEmptyContent(message);
    }

    function renderLoading(message) {
        updateRawJsonToggle(false);
        elements.reviewTitle.textContent = 'Loading review...';
        elements.reviewSummary.textContent = message;
        elements.reviewMeta.textContent = 'Fetching the requested historical version data.';
        elements.reviewContent.innerHTML = renderEmptyContent(message);
    }

    function renderDetailPage() {
        updateRawJsonToggle(false);
        const detail = state.detail;
        const snapshot = detail?.version || {};
        const title = getDrugTitleFromSnapshot(snapshot);
        const subtitle = getDrugSubtitle(snapshot);

        elements.reviewTitle.textContent = title;
        elements.reviewSummary.textContent = `Viewing ${formatVersionTag(detail.versionNumber)} for drug #${detail.drugId}.`;
        elements.reviewMeta.textContent = subtitle
            ? `${subtitle}. Open the dashboard if you want to choose another version or start a comparison.`
            : 'Open the dashboard if you want to choose another version or start a comparison.';
        elements.reviewContent.innerHTML = renderVersionDetail(detail);
        document.title = `${title} | Version review`;
    }

    function renderComparePage() {
        const [leftDetail, rightDetail] = state.compare;
        const snapshot = leftDetail?.version || {};
        const title = getDrugTitleFromSnapshot(snapshot);
        const subtitle = getDrugSubtitle(snapshot);
        const versionLabel = [leftDetail.versionNumber, rightDetail.versionNumber]
            .sort((left, right) => left - right)
            .map((versionNumber) => formatVersionTag(versionNumber))
            .join(' and ');

        elements.reviewTitle.textContent = title;
        elements.reviewSummary.textContent = `Comparing ${versionLabel} for drug #${leftDetail.drugId}.`;
        elements.reviewMeta.textContent = subtitle
            ? `${subtitle}. Use the JSON toggle if you want the exact stored payloads for both versions.`
            : 'Use the JSON toggle if you want the exact stored payloads for both versions.';
        updateRawJsonToggle(true);
        elements.reviewContent.innerHTML = state.showRawCompareJson
            ? renderCompareJson(state.compare)
            : renderVersionCompare(state.compare);
        document.title = `${title} | Version compare`;
    }

    async function loadCurrentAdmin() {
        const response = await apiRequest('/auth/me');
        const user = response?.data?.user;
        if (!user || user.role !== 'admin') {
            throw new Error('This admin site only accepts accounts with the admin role.');
        }

        state.currentAdmin = user;
        elements.currentAdminName.textContent = user.username;
    }

    async function getVersionDetail(drugId, versionNumber) {
        const response = await apiRequest(`/admin/drugs/${drugId}/versions/${versionNumber}`);
        return response?.data;
    }

    function parseRequest() {
        const searchParams = new URLSearchParams(window.location.search);
        const drugId = normalizePositiveInt(searchParams.get('drugId'));
        const versionNumber = normalizePositiveInt(searchParams.get('version'));
        const compareVersions = parseCompareVersions(searchParams.get('compare'));

        if (!drugId) {
            return { valid: false, message: 'A valid drugId is required in the review page URL.' };
        }

        if (versionNumber && compareVersions.length) {
            return { valid: false, message: 'Choose either one version or two compare versions, not both.' };
        }

        if (!versionNumber && compareVersions.length !== 2) {
            return { valid: false, message: 'Open this page from the dashboard using View or Compare selected.' };
        }

        return {
            valid: true,
            drugId,
            versionNumber,
            compareVersions,
        };
    }

    function leaveReviewPage() {
        const token = state.token;
        if (token) {
            apiRequest('/auth/logout', { method: 'POST', tokenOverride: token }).catch(() => null);
        }

        setToken(null);
        window.location.assign('./index.html');
    }

    function bindEvents() {
        elements.logoutButton.addEventListener('click', leaveReviewPage);
        elements.toggleRawJsonButton.addEventListener('click', () => {
            state.showRawCompareJson = !state.showRawCompareJson;
            if (state.compare.length === 2) {
                renderComparePage();
            }
        });
    }

    async function init() {
        bindEvents();

        if (!state.token) {
            window.location.replace('./index.html');
            return;
        }

        const request = parseRequest();
        if (!request.valid) {
            renderInvalidRequest(request.message);
            return;
        }

        state.drugId = request.drugId;
        state.versionNumber = request.versionNumber;
        state.compareVersions = request.compareVersions;

        renderLoading('Loading the requested review...');

        try {
            await loadCurrentAdmin();

            if (state.versionNumber) {
                state.detail = await getVersionDetail(state.drugId, state.versionNumber);
                renderDetailPage();
            } else {
                state.compare = await Promise.all(
                    state.compareVersions.map((versionNumber) => getVersionDetail(state.drugId, versionNumber))
                );
                renderComparePage();
            }

            setStatus('', '');
        } catch (error) {
            if (error.status === 401 || error.status === 403) {
                leaveReviewPage();
                return;
            }

            setStatus(error.message || 'Failed to load the requested review.', 'error');
            renderInvalidRequest(error.message || 'Failed to load the requested review.');
        }
    }

    init();
})();
