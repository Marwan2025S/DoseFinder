import { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { drugsApi } from '../services/api';
import {
    allDosageForms,
    allRoutes,
    getRxStatus,
    getSource,
    getHam,
    titleCase,
    extractFilterOptions,
} from '../utils/drugFilters';
import AppLayout from '../components/AppLayout';
import { canManageDrugCatalog, isPendingDoctor } from '../utils/doctorAccess';
import { getAssignedDoctorDisplay } from '../utils/doctorDisplay';
import { getDrugCatalogStatus } from '../utils/drugCatalogStatus';
import '../styles/medications.css';

const PER_PAGE = 10;

const SERVER_SORT_COLUMNS = {
    medication_name: 'generic_name',
    active_ingredients: 'brand_names',
    last_updated: 'updated_at',
    version: 'version_number',
};

/* ── display helpers ── */

const PILL_SVG = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
        <path d="m8.5 8.5 7 7" />
    </svg>
);

const ICON_COLORS = [
    { bg: '#ede9fe', color: '#7c3aed' },
    { bg: '#fce7f3', color: '#db2777' },
    { bg: '#fef3c7', color: '#d97706' },
    { bg: '#d1fae5', color: '#059669' },
    { bg: '#dbeafe', color: '#2563eb' },
];

const SORT_ICON = (
    <svg className="med-sort-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m8 11 4-4 4 4" opacity=".38" />
        <path d="m16 13-4 4-4-4" opacity=".38" />
    </svg>
);

function formatBrandNames(value) {
    if (Array.isArray(value)) {
        const items = value.map((item) => String(item || '').trim()).filter(Boolean);
        return items.length ? items.join(', ') : '-';
    }
    if (value == null) return '-';
    const str = String(value).trim();
    return str ? str.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ') : '-';
}

function getMedicationName(med) {
    return med?.generic_name || med?.display_name || med?.name || '-';
}

function getLastUpdatedLabel(drug) {
    const tryDate = (v) => {
        if (!v) return null;
        const d = new Date(v);
        return Number.isNaN(d.getTime()) ? null : d;
    };
    const date =
        tryDate(drug?.updated_at) ||
        tryDate(drug?.updatedAt) ||
        tryDate(drug?.last_updated) ||
        tryDate(drug?.lastUpdated) ||
        tryDate(drug?.created_at) ||
        tryDate(drug?.createdAt);

    if (!date) return '-';
    const diffMs = Date.now() - date.getTime();
    if (!Number.isFinite(diffMs)) return '-';
    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${Math.floor(diffHr / 24)}d ago`;
}

/* ── component ── */

export default function Medications() {
    const { user } = useAuth();
    const { showToast } = useToast();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();

    const pendingDoctor = isPendingDoctor(user);
    const canManageDrugs = canManageDrugCatalog(user);

    /* ── seed initial state from URL flags (shared contract with SearchResults) ── */
    const initialQuery = (searchParams.get('q') || '').trim();
    const initialSort = (() => {
        const raw = searchParams.get('sort');
        if (!raw) return { key: 'last_updated', asc: false };
        const [key, dir] = raw.split(':');
        const validKey = Object.prototype.hasOwnProperty.call(SERVER_SORT_COLUMNS, key) ? key : 'last_updated';
        return { key: validKey, asc: dir === 'asc' };
    })();
    const initialPage = (() => {
        const p = Number(searchParams.get('page'));
        return Number.isFinite(p) && p >= 1 ? Math.floor(p) : 1;
    })();

    /* ── data state ── */
    const [allDrugs, setAllDrugs] = useState([]);
    const [optionsDrugs, setOptionsDrugs] = useState([]);
    const [totalCount, setTotalCount] = useState(0);
    const [loading, setLoading] = useState(true);
    const [searchInput, setSearchInput] = useState(initialQuery);
    const [searchTerm, setSearchTerm] = useState(initialQuery);
    const [currentPage, setCurrentPage] = useState(initialPage);

    /* ── sort state ── */
    const [sortKey, setSortKey] = useState(initialSort.key);
    const [sortAsc, setSortAsc] = useState(initialSort.asc);

    /* ── filter UI ── */
    const [filterOpen, setFilterOpen] = useState(false);

    /* ── pending filter state ── */
    const [pendingForms, setPendingForms] = useState(() => searchParams.getAll('forms'));
    const [pendingRoutes, setPendingRoutes] = useState(() => searchParams.getAll('routes'));
    const [pendingRx, setPendingRx] = useState(() => searchParams.getAll('rx'));
    const [pendingSources, setPendingSources] = useState(() => searchParams.getAll('sources'));
    const [pendingHam, setPendingHam] = useState(() => searchParams.getAll('ham'));

    /* ── applied filter state ── */
    const [appliedForms, setAppliedForms] = useState(() => searchParams.getAll('forms'));
    const [appliedRoutes, setAppliedRoutes] = useState(() => searchParams.getAll('routes'));
    const [appliedRx, setAppliedRx] = useState(() => searchParams.getAll('rx'));
    const [appliedSources, setAppliedSources] = useState(() => searchParams.getAll('sources'));
    const [appliedHam, setAppliedHam] = useState(() => searchParams.getAll('ham'));

    const serverSortBy = SERVER_SORT_COLUMNS[sortKey] || 'drug_id';

    const activeFilterCount = [appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam]
        .reduce((n, arr) => n + arr.length, 0);

    /*
     * Pagination mode:
     *   server mode (no active filters) — 10/page from API, full catalog browsable
     *   client mode (filters active)    — 100 from API, filtered + paged client-side
     */
    const isClientMode = activeFilterCount > 0;

    /* ── debounced search ── */
    const debounceRef = useRef(null);
    const handleSearchInput = useCallback((value) => {
        setSearchInput(value);
        clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
            setSearchTerm(value);
            setCurrentPage(1);
        }, 300);
    }, []);

    const fetchIdRef = useRef(0);

    /* ── server-mode fetch: paginated browse ── */
    useEffect(() => {
        if (isClientMode) return;

        const fetchId = ++fetchIdRef.current;
        let cancelled = false;

        setLoading(true);
        drugsApi
            .search({
                q: searchTerm || undefined,
                page: currentPage,
                per_page: PER_PAGE,
                sort_by: serverSortBy,
                sort_order: sortAsc ? 'asc' : 'desc',
                include_doctor: true,
            })
            .then((res) => {
                if (!cancelled && fetchId === fetchIdRef.current) {
                    setAllDrugs(res?.results || []);
                    setTotalCount(Number(res?.total ?? 0));
                }
            })
            .catch((err) => {
                if (!cancelled && fetchId === fetchIdRef.current) {
                    showToast(err.message || 'Failed to load medications');
                    setAllDrugs([]);
                    setTotalCount(0);
                }
            })
            .finally(() => {
                if (!cancelled && fetchId === fetchIdRef.current) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [searchTerm, sortKey, sortAsc, serverSortBy, currentPage, isClientMode, showToast]);

    /* ── client-mode fetch: bulk load for client-side filtering ── */
    useEffect(() => {
        if (!isClientMode) return;

        const fetchId = ++fetchIdRef.current;
        let cancelled = false;

        setLoading(true);
        drugsApi
            .search({
                q: searchTerm || undefined,
                page: 1,
                per_page: 100,
                sort_by: serverSortBy,
                sort_order: sortAsc ? 'asc' : 'desc',
                include_doctor: true,
            })
            .then((res) => {
                if (!cancelled && fetchId === fetchIdRef.current) {
                    setAllDrugs(res?.results || []);
                }
            })
            .catch((err) => {
                if (!cancelled && fetchId === fetchIdRef.current) {
                    showToast(err.message || 'Failed to load medications');
                    setAllDrugs([]);
                }
            })
            .finally(() => {
                if (!cancelled && fetchId === fetchIdRef.current) setLoading(false);
            });

        return () => { cancelled = true; };
    }, [searchTerm, sortKey, sortAsc, serverSortBy, isClientMode, showToast]);

    /* ── reset to page 1 when switching modes (skip initial mount so a shared ?page= survives) ── */
    const modeInitRef = useRef(true);
    useEffect(() => {
        if (modeInitRef.current) {
            modeInitRef.current = false;
            return;
        }
        setCurrentPage(1);
    }, [isClientMode]);

    /*
     * Reflect search / filters / sort / page into the URL using the same flag
     * names as SearchResults (q, forms, routes, rx, sources, ham) so doctor
     * searches are shareable, bookmarkable, and survive a refresh. Written with
     * { replace: true } so typing/filtering doesn't pollute browser history.
     */
    useEffect(() => {
        const next = new URLSearchParams();
        if (searchTerm) next.set('q', searchTerm);
        appliedForms.forEach((f) => next.append('forms', f));
        appliedRoutes.forEach((r) => next.append('routes', r));
        appliedRx.forEach((r) => next.append('rx', r));
        appliedSources.forEach((s) => next.append('sources', s));
        appliedHam.forEach((h) => next.append('ham', h));
        // Same `sort` flag name as SearchResults, but the doctor table sorts by
        // column, so encode as `<key>:<dir>`; omit the default (last_updated desc).
        if (!(sortKey === 'last_updated' && !sortAsc)) {
            next.set('sort', `${sortKey}:${sortAsc ? 'asc' : 'desc'}`);
        }
        if (currentPage > 1) next.set('page', String(currentPage));
        setSearchParams(next, { replace: true });
    }, [searchTerm, appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam, sortKey, sortAsc, currentPage, setSearchParams]);

    /* ── options-pool fetch: always 100 items for filter panel checkboxes ── */
    const optionsFetchRef = useRef(0);
    useEffect(() => {
        const fetchId = ++optionsFetchRef.current;
        drugsApi
            .search({
                q: searchTerm || undefined,
                page: 1,
                per_page: 100,
                sort_by: serverSortBy,
                sort_order: 'desc',
                include_doctor: true,
            })
            .then((res) => {
                if (fetchId === optionsFetchRef.current) {
                    setOptionsDrugs(res?.results || []);
                }
            })
            .catch(() => {});
    }, [searchTerm, serverSortBy]);

    /* ── dynamic filter options (from wider options pool) ── */
    const filterOptions = useMemo(() => extractFilterOptions(optionsDrugs), [optionsDrugs]);

    /* ── filter helpers ── */
    const togglePending = (setter, value) =>
        setter((prev) => (prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]));

    const confirmFilters = () => {
        setAppliedForms([...pendingForms]);
        setAppliedRoutes([...pendingRoutes]);
        setAppliedRx([...pendingRx]);
        setAppliedSources([...pendingSources]);
        setAppliedHam([...pendingHam]);
        setCurrentPage(1);
        setFilterOpen(false);
        showToast('Filters applied');
    };

    const clearFilters = () => {
        setPendingForms([]); setPendingRoutes([]); setPendingRx([]); setPendingSources([]); setPendingHam([]);
        setAppliedForms([]); setAppliedRoutes([]); setAppliedRx([]); setAppliedSources([]); setAppliedHam([]);
        setCurrentPage(1);
        showToast('Filters cleared');
    };

    const removeApplied = (type, value) => {
        const ops = {
            forms: [setAppliedForms, setPendingForms, appliedForms],
            routes: [setAppliedRoutes, setPendingRoutes, appliedRoutes],
            rx: [setAppliedRx, setPendingRx, appliedRx],
            sources: [setAppliedSources, setPendingSources, appliedSources],
            ham: [setAppliedHam, setPendingHam, appliedHam],
        };
        const [setApplied, setPending, current] = ops[type];
        const next = current.filter((v) => v !== value);
        setApplied(next);
        setPending(next);
        setCurrentPage(1);
    };

    const hasPendingChanges = useMemo(
        () =>
            JSON.stringify([pendingForms, pendingRoutes, pendingRx, pendingSources, pendingHam]) !==
            JSON.stringify([appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam]),
        [pendingForms, pendingRoutes, pendingRx, pendingSources, pendingHam,
            appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam],
    );

    /* ── client-side filtering (only used in client mode) ── */
    const filteredDrugs = useMemo(() => {
        let result = [...allDrugs];
        if (appliedForms.length > 0) result = result.filter((d) => allDosageForms(d).some((f) => appliedForms.includes(f)));
        if (appliedRoutes.length > 0) result = result.filter((d) => allRoutes(d).some((r) => appliedRoutes.includes(r)));
        if (appliedRx.length > 0) result = result.filter((d) => appliedRx.includes(getRxStatus(d)));
        if (appliedSources.length > 0) result = result.filter((d) => appliedSources.includes(getSource(d).toLowerCase()));
        if (appliedHam.length > 0) result = result.filter((d) => appliedHam.includes(getHam(d)));
        return result;
    }, [allDrugs, appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam]);

    /* ── pagination ── */
    const displayTotal = isClientMode ? filteredDrugs.length : totalCount;
    const totalPages = Math.max(1, Math.ceil(displayTotal / PER_PAGE));
    const activePage = Math.max(1, Math.min(currentPage, totalPages));
    const start = (activePage - 1) * PER_PAGE;

    // In server mode the API already returns the right page slice; in client mode we slice ourselves.
    const pageMeds = isClientMode ? filteredDrugs.slice(start, start + PER_PAGE) : allDrugs;

    const pageNumbers = useMemo(() => {
        const maxVisible = 5;
        const s = Math.max(1, activePage - Math.floor(maxVisible / 2));
        const e = Math.min(totalPages, s + maxVisible - 1);
        const ns = Math.max(1, e - maxVisible + 1);
        return Array.from({ length: e - ns + 1 }, (_, i) => ns + i);
    }, [activePage, totalPages]);

    /* ── sort (column headers) ── */
    const handleSort = (key) => {
        if (sortKey === key) setSortAsc(!sortAsc);
        else { setSortKey(key); setSortAsc(true); }
        setCurrentPage(1);
    };

    const sortState = (key) => {
        if (sortKey !== key) return 'none';
        return sortAsc ? 'ascending' : 'descending';
    };

    /* ── navigation ── */
    const navigateToDrug = (drugId) => { if (drugId) navigate(`/drug/${drugId}`); };

    const handleDrugRowKeyDown = (e, drugId) => {
        if (e.target !== e.currentTarget) return;
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        navigateToDrug(drugId);
    };

    /* ── active chip list ── */
    const activeChips = [
        ...appliedForms.map((v) => ({ type: 'forms', label: titleCase(v), value: v })),
        ...appliedRoutes.map((v) => ({ type: 'routes', label: titleCase(v), value: v })),
        ...appliedRx.map((v) => ({ type: 'rx', label: v, value: v })),
        ...appliedSources.map((v) => ({ type: 'sources', label: titleCase(v), value: v })),
        ...appliedHam.map((v) => ({ type: 'ham', label: `HAM: ${v}`, value: v })),
    ];

    /* ── result count label ── */
    const resultLabel = loading
        ? 'Loading...'
        : isClientMode
            ? filteredDrugs.length === 0
                ? 'No medications match the active filters'
                : `Showing ${start + 1}–${Math.min(start + PER_PAGE, filteredDrugs.length)} of ${filteredDrugs.length} filtered results`
            : displayTotal === 0
                ? 'No medications found'
                : `Showing ${start + 1}–${Math.min(start + PER_PAGE, displayTotal)} of ${displayTotal}`;

    return (
        <AppLayout>
            <main className="app-content">
                {/* Page header */}
                <div className="med-page-header">
                    <div>
                        <h1 className="med-page-title">Medications</h1>
                        <p className="med-page-sub">Search and filter the medication catalog.</p>
                    </div>
                    {canManageDrugs ? (
                        <Link to="/add-drug" className="app-btn app-btn--primary">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                <line x1="12" y1="5" x2="12" y2="19" />
                                <line x1="5" y1="12" x2="19" y2="12" />
                            </svg>
                            Add New Medication
                        </Link>
                    ) : (
                        <button type="button" className="app-btn app-btn--primary app-btn--disabled" disabled>
                            Add New Medication
                        </button>
                    )}
                </div>

                {pendingDoctor && (
                    <section className="doctor-approval-banner" aria-live="polite">
                        <strong className="doctor-approval-banner__title">Doctor approval pending</strong>
                        <p className="doctor-approval-banner__text">
                            Medication records stay read-only until your doctor account is approved.
                        </p>
                    </section>
                )}

                {/* Search & filter section */}
                <div className="med-search-section">
                    <div className="med-search-bar">
                        <div className="med-search-input-wrap" role="search">
                            <span className="med-search-icon" aria-hidden="true">
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                    <circle cx="11" cy="11" r="8" />
                                    <path d="m21 21-4.35-4.35" />
                                </svg>
                            </span>
                            <input
                                type="search"
                                className="med-search-input"
                                placeholder="Search by name, brand name, or Arabic trade name..."
                                aria-label="Search medications"
                                autoComplete="off"
                                value={searchInput}
                                onChange={(e) => handleSearchInput(e.target.value)}
                            />
                            {searchInput && (
                                <button
                                    type="button"
                                    className="med-search-clear"
                                    aria-label="Clear search"
                                    onClick={() => { setSearchInput(''); setSearchTerm(''); setCurrentPage(1); }}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                        <path d="M18 6 6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            )}
                        </div>
                        <button
                            type="button"
                            className={`med-filter-toggle ${filterOpen ? 'med-filter-toggle--open' : ''} ${activeFilterCount > 0 ? 'med-filter-toggle--active' : ''}`}
                            onClick={() => setFilterOpen((v) => !v)}
                            aria-expanded={filterOpen}
                            aria-label="Toggle filters"
                        >
                            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                                <path d="M22 3H2l8 9.46V19l4 2v-8.54L22 3z" />
                            </svg>
                            Filters
                            {activeFilterCount > 0 && (
                                <span className="med-filter-badge">{activeFilterCount}</span>
                            )}
                        </button>
                    </div>

                    {/* Filter panel */}
                    {filterOpen && (
                        <div className="med-filter-panel" role="region" aria-label="Filter options">
                            <div className="med-filter-panel-grid">
                                {filterOptions.forms.length > 0 && (
                                    <div className="med-filter-section">
                                        <h3 className="med-filter-section-title">Dosage Form</h3>
                                        <div className="med-filter-check-list">
                                            {filterOptions.forms.map(({ value, count }) => (
                                                <label key={value} className="med-filter-check-label">
                                                    <input type="checkbox" checked={pendingForms.includes(value)} onChange={() => togglePending(setPendingForms, value)} />
                                                    <span className="med-filter-check-box" />
                                                    <span className="med-filter-check-text">{titleCase(value)}</span>
                                                    <span className="med-filter-check-count">({count})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {filterOptions.routes.length > 0 && (
                                    <div className="med-filter-section">
                                        <h3 className="med-filter-section-title">Route of Administration</h3>
                                        <div className="med-filter-check-list">
                                            {filterOptions.routes.map(({ value, count }) => (
                                                <label key={value} className="med-filter-check-label">
                                                    <input type="checkbox" checked={pendingRoutes.includes(value)} onChange={() => togglePending(setPendingRoutes, value)} />
                                                    <span className="med-filter-check-box" />
                                                    <span className="med-filter-check-text">{titleCase(value)}</span>
                                                    <span className="med-filter-check-count">({count})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {filterOptions.rxStatuses.length > 0 && (
                                    <div className="med-filter-section">
                                        <h3 className="med-filter-section-title">Rx Status</h3>
                                        <div className="med-filter-check-list">
                                            {filterOptions.rxStatuses.map(({ value, count }) => (
                                                <label key={value} className="med-filter-check-label">
                                                    <input type="checkbox" checked={pendingRx.includes(value)} onChange={() => togglePending(setPendingRx, value)} />
                                                    <span className="med-filter-check-box" />
                                                    <span className="med-filter-check-text">{value}</span>
                                                    <span className="med-filter-check-count">({count})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {filterOptions.hamValues.length > 0 && (
                                    <div className="med-filter-section">
                                        <h3 className="med-filter-section-title">High Alert Medication</h3>
                                        <div className="med-filter-check-list">
                                            {filterOptions.hamValues.map(({ value, count }) => (
                                                <label key={value} className="med-filter-check-label">
                                                    <input type="checkbox" checked={pendingHam.includes(value)} onChange={() => togglePending(setPendingHam, value)} />
                                                    <span className="med-filter-check-box" />
                                                    <span className="med-filter-check-text">{value}</span>
                                                    <span className="med-filter-check-count">({count})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {filterOptions.sources.length > 0 && (
                                    <div className="med-filter-section">
                                        <h3 className="med-filter-section-title">Source</h3>
                                        <div className="med-filter-check-list">
                                            {filterOptions.sources.map(({ value, count }) => (
                                                <label key={value} className="med-filter-check-label">
                                                    <input type="checkbox" checked={pendingSources.includes(value)} onChange={() => togglePending(setPendingSources, value)} />
                                                    <span className="med-filter-check-box" />
                                                    <span className="med-filter-check-text">{titleCase(value)}</span>
                                                    <span className="med-filter-check-count">({count})</span>
                                                </label>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="med-filter-panel-footer">
                                <button
                                    type="button"
                                    className={`med-filter-confirm ${hasPendingChanges ? 'med-filter-confirm--active' : ''}`}
                                    disabled={!hasPendingChanges}
                                    onClick={confirmFilters}
                                >
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                        <path d="m5 13 4 4L19 7" />
                                    </svg>
                                    Apply Filters
                                </button>
                                <button
                                    type="button"
                                    className="med-filter-clear"
                                    disabled={activeFilterCount === 0 && !hasPendingChanges}
                                    onClick={clearFilters}
                                >
                                    Clear All
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Active filter chips */}
                    {activeChips.length > 0 && (
                        <div className="med-active-filters" aria-label="Active filters">
                            <span className="med-active-filters-label">Filters:</span>
                            <div className="med-active-filter-chips">
                                {activeChips.map((chip) => (
                                    <button
                                        key={`${chip.type}:${chip.value}`}
                                        type="button"
                                        className="med-active-chip"
                                        onClick={() => removeApplied(chip.type, chip.value)}
                                        aria-label={`Remove filter: ${chip.label}`}
                                    >
                                        {chip.label}
                                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                                            <path d="M18 6 6 18M6 6l12 12" />
                                        </svg>
                                    </button>
                                ))}
                                <button type="button" className="med-clear-all-chip" onClick={clearFilters}>
                                    Clear all
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Result count */}
                    <div className="med-results-meta">
                        <span className="med-results-count">
                            {resultLabel}
                            {activeFilterCount > 0 && !loading && (
                                <span className="med-filter-active-badge">
                                    {activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active
                                </span>
                            )}
                        </span>
                    </div>
                </div>

                {/* Medications table */}
                <section className="med-card" aria-label="Medication table">
                    <div className="med-table-wrap">
                        {loading ? (
                            <div className="doctor-table-loading doctor-table-loading--large" role="status" aria-live="polite" aria-busy="true">
                                <div className="doctor-table-spinner" aria-hidden="true" />
                                <span>Loading medications...</span>
                            </div>
                        ) : (
                            <table className="med-table">
                                <thead>
                                    <tr>
                                        <th scope="col" className="med-table__th">
                                            <button type="button" className="med-sort-btn" aria-sort={sortState('medication_name')} onClick={() => handleSort('medication_name')}>
                                                MEDICATION NAME{SORT_ICON}
                                            </button>
                                        </th>
                                        <th scope="col" className="med-table__th">
                                            <button type="button" className="med-sort-btn" aria-sort={sortState('active_ingredients')} onClick={() => handleSort('active_ingredients')}>
                                                BRAND / TRADE{SORT_ICON}
                                            </button>
                                        </th>
                                        <th scope="col" className="med-table__th">
                                            <button type="button" className="med-sort-btn" aria-sort={sortState('last_updated')} onClick={() => handleSort('last_updated')}>
                                                LAST UPDATED{SORT_ICON}
                                            </button>
                                        </th>
                                        <th scope="col" className="med-table__th">ASSIGNED DOCTOR</th>
                                        <th scope="col" className="med-table__th">
                                            <button type="button" className="med-sort-btn" aria-sort={sortState('version')} onClick={() => handleSort('version')}>
                                                VERSION{SORT_ICON}
                                            </button>
                                        </th>
                                        <th scope="col" className="med-table__th med-table__th--right">ACTIONS</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pageMeds.length === 0 ? (
                                        <tr>
                                            <td className="med-table__td" colSpan={6}>
                                                <div className="med-empty">
                                                    <span className="med-empty__text">No medications found</span>
                                                </div>
                                            </td>
                                        </tr>
                                    ) : (
                                        pageMeds.map((med, idx) => {
                                            const drugId = med.drug_id ?? med.id ?? med.version_id;
                                            const ic = ICON_COLORS[(start + idx) % ICON_COLORS.length];
                                            const catalogStatus = getDrugCatalogStatus(med);
                                            const time = getLastUpdatedLabel(med);
                                            const assignedDoctor = getAssignedDoctorDisplay(med);
                                            return (
                                                <tr
                                                    key={drugId || idx}
                                                    className="med-table__row--clickable"
                                                    role="link"
                                                    tabIndex={0}
                                                    onClick={() => navigateToDrug(drugId)}
                                                    onKeyDown={(e) => handleDrugRowKeyDown(e, drugId)}
                                                >
                                                    <td className="med-table__td">
                                                        <div className="dash-med-row">
                                                            <span className="dash-med-icon" style={{ background: ic.bg, color: ic.color }} aria-hidden="true">
                                                                {PILL_SVG}
                                                            </span>
                                                            <span className="dash-med-name">{getMedicationName(med)}</span>
                                                        </div>
                                                    </td>
                                                    <td className="med-table__td">{formatBrandNames(med.brand_names_list || med.brand_names)}</td>
                                                    <td className="med-table__td">{time}</td>
                                                    <td className="med-table__td">
                                                        <div className="dash-doctor">
                                                            <div className="dash-doctor__avatar" aria-hidden="true">
                                                                <span className="dash-doctor__fallback">{assignedDoctor.initials}</span>
                                                            </div>
                                                            {assignedDoctor.label}
                                                        </div>
                                                    </td>
                                                    <td className="med-table__td">
                                                        <span className={`app-badge app-badge--${catalogStatus.tone}`}>
                                                            {catalogStatus.label}
                                                        </span>
                                                    </td>
                                                    <td className="med-table__td med-table__td--right" onClick={(e) => e.stopPropagation()}>
                                                        <button
                                                            className="med-action-btn med-action-btn--edit"
                                                            title={canManageDrugs ? 'Edit' : 'Doctor approval pending'}
                                                            type="button"
                                                            disabled={!canManageDrugs}
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                navigate(`/edit-drug/${drugId}`);
                                                            }}
                                                        >
                                                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                                                <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                                                                <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                                                            </svg>
                                                        </button>
                                                    </td>
                                                </tr>
                                            );
                                        })
                                    )}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {totalPages > 1 && (
                        <div className="med-pagination">
                            <span className="med-pagination__info">
                                Page {activePage} of {totalPages}
                                {isClientMode ? ` (${filteredDrugs.length} filtered)` : ` (${displayTotal} total)`}
                            </span>
                            <div className="med-pagination__controls">
                                <button disabled={activePage === 1} onClick={() => setCurrentPage((p) => p - 1)} className="med-page-btn">Prev</button>
                                {pageNumbers.map((page) => (
                                    <button
                                        key={page}
                                        type="button"
                                        className={`med-page-btn ${page === activePage ? 'med-page-btn--active' : ''}`}
                                        onClick={() => setCurrentPage(page)}
                                        aria-label={`Go to page ${page}`}
                                        aria-current={page === activePage ? 'page' : undefined}
                                    >
                                        {page}
                                    </button>
                                ))}
                                <button disabled={activePage >= totalPages} onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))} className="med-page-btn">Next</button>
                            </div>
                        </div>
                    )}
                </section>
            </main>
        </AppLayout>
    );
}
