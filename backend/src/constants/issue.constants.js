const ISSUE_STATUS = Object.freeze({
    OPEN: 'open',
    CLOSED: 'closed',
    FIXED: 'fixed'
});

const ISSUE_PART_OPTIONS = Object.freeze([
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
    { key: 'other', label: 'Other' }
]);

const ISSUE_PART_LABELS = Object.freeze(
    Object.fromEntries(ISSUE_PART_OPTIONS.map((option) => [option.key, option.label]))
);

const ISSUE_MESSAGE_MAX_LENGTH = 1000;
const ISSUE_REPLY_MAX_LENGTH = 1000;

module.exports = {
    ISSUE_STATUS,
    ISSUE_PART_OPTIONS,
    ISSUE_PART_LABELS,
    ISSUE_MESSAGE_MAX_LENGTH,
    ISSUE_REPLY_MAX_LENGTH
};
