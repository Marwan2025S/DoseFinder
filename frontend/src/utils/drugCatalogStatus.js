export function getDrugVersionLabel(drug) {
    const versionNumber = Number(drug?.version_number ?? drug?.latestVersionNumber);
    if (Number.isFinite(versionNumber) && versionNumber > 0) {
        return `v${versionNumber}`;
    }
    return '-';
}

export function getDrugCatalogStatus(drug) {
    const flags = drug?.adminFlags || {};

    if (flags.visibility === 'hidden') {
        return {
            tone: 'inactive',
            label: 'Hidden',
        };
    }

    if (flags.reviewStatus === 'needs_review') {
        return {
            tone: 'review',
            label: 'Needs review',
        };
    }

    const versionLabel = getDrugVersionLabel(drug);
    const isCurrent = Number(drug?.is_current) === 1;

    return {
        tone: isCurrent ? 'active' : 'inactive',
        label: isCurrent ? `${versionLabel} Current` : versionLabel,
    };
}
