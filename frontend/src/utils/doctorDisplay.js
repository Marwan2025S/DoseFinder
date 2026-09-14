function toTitleCase(value) {
    return value
        .split(/\s+/)
        .filter(Boolean)
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(' ');
}

function getDoctorName(doctor) {
    const rawName = typeof doctor?.username === 'string' ? doctor.username.trim() : '';
    if (!rawName) return null;

    const cleanedName = rawName.replace(/[._-]+/g, ' ').trim();
    if (!cleanedName) return null;

    if (/^system$/i.test(cleanedName)) {
        return 'System';
    }

    const titleCased = toTitleCase(cleanedName);
    return /^dr\.?\s/i.test(titleCased) ? titleCased : `Dr. ${titleCased}`;
}

function getInitials(label) {
    if (!label || label === '—') return '--';

    const parts = label
        .replace(/^Dr\.?\s+/i, '')
        .split(/\s+/)
        .filter(Boolean);

    if (!parts.length) return '--';
    return parts.slice(0, 2).map((part) => part.charAt(0).toUpperCase()).join('');
}

export function getAssignedDoctorDisplay(drug) {
    const doctor = drug?.assignedDoctor ?? drug?.assigned_doctor ?? drug?.latestVersionDoctor ?? drug?.doctor ?? null;
    const label = getDoctorName(doctor) || '—';

    return {
        label,
        initials: getInitials(label),
    };
}
