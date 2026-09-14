export const ISSUE_STATUSES = Object.freeze({
    OPEN: 'open',
    CLOSED: 'closed',
    FIXED: 'fixed',
});

export const ISSUE_STATUS_LABELS = Object.freeze({
    [ISSUE_STATUSES.OPEN]: 'Open',
    [ISSUE_STATUSES.CLOSED]: 'Closed',
    [ISSUE_STATUSES.FIXED]: 'Fixed',
});

export const ISSUE_PART_OPTIONS = Object.freeze([
    { key: 'drug_name', label: 'Generic Name' },
    { key: 'brand_names', label: 'Brand Names' },
    { key: 'classes', label: 'Classes' },
    { key: 'dosage_strength', label: 'Dosage Form / Strength' },
    { key: 'routes', label: 'DMS Route' },
    { key: 'dosing', label: 'Dosing' },
    { key: 'warnings', label: 'Warnings' },
    { key: 'side_effects', label: 'Adverse Effects' },
    { key: 'interactions', label: 'Interactions' },
    { key: 'pregnancy_lactation', label: 'Pregnancy & Lactation' },
    { key: 'pharmacology', label: 'Pharmacology' },
    { key: 'administration', label: 'Administration' },
    { key: 'fda_metadata', label: 'FDA Metadata' },
    { key: 'arabic_name', label: 'Arabic Name' },
    { key: 'notes', label: 'Notes' },
    { key: 'other', label: 'Other' },
]);

export const ISSUE_PART_LABELS = Object.freeze(
    Object.fromEntries(ISSUE_PART_OPTIONS.map((option) => [option.key, option.label]))
);

export const ISSUE_FILTER_OPTIONS = Object.freeze([
    { key: 'open', label: 'Open' },
    { key: 'all', label: 'All' },
    { key: 'fixed', label: 'Fixed' },
    { key: 'closed', label: 'Closed' },
]);

export function getIssueStatusLabel(status) {
    return ISSUE_STATUS_LABELS[status] || 'Open';
}

export function getIssueStatusClassName(status) {
    switch (status) {
        case ISSUE_STATUSES.CLOSED:
            return 'issue-status--closed';
        case ISSUE_STATUSES.FIXED:
            return 'issue-status--fixed';
        case ISSUE_STATUSES.OPEN:
        default:
            return 'issue-status--open';
    }
}

export function getIssuePartLabel(partKey) {
    return ISSUE_PART_LABELS[partKey] || ISSUE_PART_LABELS.other;
}

export function formatIssueDate(value, { includeTime = false } = {}) {
    if (!value) return '—';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '—';
    return date.toLocaleString(undefined, includeTime
        ? {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit',
        }
        : {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
        });
}
