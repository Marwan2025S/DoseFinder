/*
 * Shared drug filter / display helpers used by the doctor Medications search
 * (pages/Medications.jsx) and the public SearchResults page (pages/SearchResults.jsx),
 * so both pages filter and bucket options identically.
 */

export const parseStringArray = (value) => {
    if (Array.isArray(value)) return value.map((v) => String(v ?? '').trim()).filter(Boolean);
    if (typeof value !== 'string') return [];
    const raw = value.trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) return parsed.map((v) => String(v ?? '').trim()).filter(Boolean);
    } catch { /* ignore */ }
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
};

export const firstExtension = (d) => (Array.isArray(d?.drug_dms_extensions) ? d.drug_dms_extensions[0] : null);

/** Collect all dosage form strings from a drug (may have multiple) */
export const allDosageForms = (d) => {
    const forms = new Set();
    if (Array.isArray(d?.dosage_forms)) {
        d.dosage_forms.forEach((f) => {
            const n = (f?.form_name || f?.name || '').trim();
            if (n) forms.add(n.toLowerCase());
        });
    }
    const single = (d?.dosage_form || d?.form || '').trim();
    if (single) forms.add(single.toLowerCase());
    return [...forms];
};

/** Collect all route strings from a drug */
export const allRoutes = (d) => {
    const routes = new Set();
    parseStringArray(firstExtension(d)?.route ?? d?.route).forEach((r) => routes.add(r.toLowerCase()));
    return [...routes];
};

export const getRxStatus = (d) => String(d?.rx_status || d?.rx || '').trim();

export const getSource = (d) => String(d?.source || '').trim() || 'DMS';

export const getHam = (d) => {
    const v = String(d?.ham || '').trim().toUpperCase();
    if (v === 'YES' || v === 'TRUE' || v === '1') return 'YES';
    if (v === 'NO' || v === 'FALSE' || v === '0') return 'NO';
    return '';
};

export const getPrice = (d) => d?.price ?? firstExtension(d)?.price;
export const hasPrice = (d) => getPrice(d) != null && getPrice(d) !== '';

export const titleCase = (s) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : s);

/*
 * Extract unique filter options (with counts) from a list of drugs.
 * Options:
 *   maxForms            – cap on dosage-form options (default 10)
 *   dropSingletonForms  – when the form list is large (>= maxForms), drop forms
 *                         that appear only once before capping (SearchResults behavior)
 */
export function extractFilterOptions(drugs, { maxForms = 10, dropSingletonForms = false } = {}) {
    const forms = new Map();
    const routes = new Map();
    const rxStatuses = new Map();
    const sources = new Map();
    const hamValues = new Map();
    let minPriceFound = Infinity;
    let maxPriceFound = 0;

    drugs.forEach((d) => {
        allDosageForms(d).forEach((f) => forms.set(f, (forms.get(f) || 0) + 1));
        allRoutes(d).forEach((r) => routes.set(r, (routes.get(r) || 0) + 1));
        const rx = getRxStatus(d);
        if (rx) rxStatuses.set(rx, (rxStatuses.get(rx) || 0) + 1);
        const src = getSource(d).toLowerCase();
        if (src) sources.set(src, (sources.get(src) || 0) + 1);
        const ham = getHam(d);
        if (ham) hamValues.set(ham, (hamValues.get(ham) || 0) + 1);
        if (hasPrice(d)) {
            const p = Number(getPrice(d));
            if (Number.isFinite(p)) {
                if (p < minPriceFound) minPriceFound = p;
                if (p > maxPriceFound) maxPriceFound = p;
            }
        }
    });

    const toSorted = (m) =>
        [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));

    let sortedForms = toSorted(forms);
    if (dropSingletonForms && sortedForms.length >= maxForms) {
        sortedForms = sortedForms.filter((f) => f.count > 1);
    }
    sortedForms = sortedForms.slice(0, maxForms);

    return {
        forms: sortedForms,
        routes: toSorted(routes),
        rxStatuses: toSorted(rxStatuses),
        sources: toSorted(sources),
        hamValues: toSorted(hamValues),
        priceRange: {
            min: minPriceFound === Infinity ? 0 : Math.floor(minPriceFound),
            max: maxPriceFound === 0 ? 500 : Math.ceil(maxPriceFound),
        },
    };
}
