/*
 * Returns where a search submission should navigate.
 * Doctors get the doctor search page (/search → Medications, made role-aware in App.jsx);
 * everyone else keeps the public results page (/search-results).
 */
export function buildSearchPath(user, query) {
    const base = user?.role === 'doctor' ? '/search' : '/search-results';
    const q = (query || '').trim();
    return q ? `${base}?q=${encodeURIComponent(q)}` : base;
}
