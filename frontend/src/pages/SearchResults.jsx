import { useMemo, useState, useRef, useCallback, useEffect } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import SearchHeader from '../components/SearchHeader';
import Footer from '../components/Footer';
import { useToast } from '../components/Toast';
import { useSavedItems } from '../hooks/useSavedItems';
import { drugsApi } from '../services/api';
import { getDosageFormIcon } from '../utils/getDosageFormIcon';
import {
    allDosageForms,
    allRoutes,
    titleCase,
    getRxStatus as displayRxStatus,
    getSource as displaySource,
    getHam as displayHam,
    getPrice,
    hasPrice,
    extractFilterOptions,
} from '../utils/drugFilters';
import '../styles/search-results.css';

const CARDS_PER_PAGE = 4;

/* ── SearchResults-specific display helpers (shared filter helpers live in utils/drugFilters) ── */

const displayName = (d) => d.generic_name || d.display_name || d.name || 'Unknown Drug';
const displayGenericName = displayName;
const displayTradeName = (d) => d.brand_names || '';
const isMedScapeSource = (d) => /medscape/i.test(displaySource(d));
const displayPrice = (d) => String(getPrice(d));

const firstDosageForm = (d) => {
    if (Array.isArray(d?.dosage_forms) && d.dosage_forms.length > 0)
        return d.dosage_forms[0]?.form_name || d.dosage_forms[0]?.name || '';
    if (typeof d?.dosage_forms === 'string') {
        try {
            const parsed = JSON.parse(d.dosage_forms);
            if (Array.isArray(parsed) && parsed.length > 0)
                return parsed[0]?.form_name || parsed[0]?.name || '';
        } catch { /* ignore */ }
    }
    return d?.dosage_form || d?.form || '';
};

/* ════════════════════════════════════════════════════════ */
/*                     MAIN COMPONENT                      */
/* ════════════════════════════════════════════════════════ */

export default function SearchResults() {
    const { showToast } = useToast();
    const { savedIdSet, saveItem, removeItem } = useSavedItems();
    const [searchParams, setSearchParams] = useSearchParams();
    const [currentPage, setCurrentPage] = useState(1);
    const queryTerm = (searchParams.get('q') || '').trim();

    // API results state
    const [drugs, setDrugs] = useState([]);
    const [apiLoading, setApiLoading] = useState(false);
    const [apiError, setApiError] = useState(null);

    /* ── Pending filter state (not applied until confirm) ── */
    const [pendingForms, setPendingForms] = useState(() => searchParams.getAll('forms'));
    const [pendingRoutes, setPendingRoutes] = useState(() => searchParams.getAll('routes'));
    const [pendingRx, setPendingRx] = useState(() => searchParams.getAll('rx'));
    const [pendingSources, setPendingSources] = useState(() => searchParams.getAll('sources'));
    const [pendingHam, setPendingHam] = useState(() => searchParams.getAll('ham'));
    const [pendingMinPrice, setPendingMinPrice] = useState(() => {
        const v = searchParams.get('minPrice');
        return v !== null ? Number(v) : 0;
    });
    const [pendingMaxPrice, setPendingMaxPrice] = useState(() => {
        const v = searchParams.get('maxPrice');
        return v !== null ? Number(v) : 500;
    });

    /* ── Applied (confirmed) filter state ── */
    const [appliedForms, setAppliedForms] = useState(() => searchParams.getAll('forms'));
    const [appliedRoutes, setAppliedRoutes] = useState(() => searchParams.getAll('routes'));
    const [appliedRx, setAppliedRx] = useState(() => searchParams.getAll('rx'));
    const [appliedSources, setAppliedSources] = useState(() => searchParams.getAll('sources'));
    const [appliedHam, setAppliedHam] = useState(() => searchParams.getAll('ham'));
    const [appliedMinPrice, setAppliedMinPrice] = useState(() => {
        const v = searchParams.get('minPrice');
        return v !== null ? Number(v) : 0;
    });
    const [appliedMaxPrice, setAppliedMaxPrice] = useState(() => {
        const v = searchParams.get('maxPrice');
        return v !== null ? Number(v) : 500;
    });

    const [sortBy, setSortBy] = useState(() => searchParams.get('sort') || 'relevance');
    const [filterDrawerOpen, setFilterDrawerOpen] = useState(false);

    // Tracks whether price was loaded from URL so the data-range effect doesn't override it
    const hadPriceInUrl = useRef(searchParams.has('minPrice') || searchParams.has('maxPrice'));

    // UI state for collapsibles
    const [collapsed, setCollapsed] = useState({
        formFilter: false,
        routeFilter: true,
        priceFilter: false,
        rxFilter: true,
        sourceFilter: true,
        hamFilter: true,
    });

    /* ── Fetch drugs from API (unfiltered – filtering is client-side) ── */
    const fetchIdRef = useRef(0);
    useEffect(() => {
        const currentFetchId = ++fetchIdRef.current;
        let cancelled = false;
        const fetchDrugs = async () => {
            setApiLoading(true);
            setApiError(null);
            try {
                const res = await drugsApi.search({
                    q: queryTerm || undefined,
                    page: 1,
                    per_page: 100,
                });
                if (!cancelled && currentFetchId === fetchIdRef.current) {
                    const items = Array.isArray(res?.results) ? res.results : [];
                    setDrugs(items);
                }
            } catch (err) {
                if (!cancelled && currentFetchId === fetchIdRef.current) {
                    setApiError(err.message || 'Failed to search drugs');
                    setDrugs([]);
                }
            } finally {
                if (!cancelled && currentFetchId === fetchIdRef.current) setApiLoading(false);
            }
        };
        fetchDrugs();
        return () => { cancelled = true; };
    }, [queryTerm]);

    /* ── Extract dynamic filter options from results ── */
    const filterOptions = useMemo(() => extractFilterOptions(drugs, { dropSingletonForms: true }), [drugs]);

    // Reset pending price to actual data range when results arrive (skip if price came from URL)
    useEffect(() => {
        if (!hadPriceInUrl.current) {
            setPendingMinPrice(filterOptions.priceRange.min);
            setPendingMaxPrice(filterOptions.priceRange.max);
            setAppliedMinPrice(filterOptions.priceRange.min);
            setAppliedMaxPrice(filterOptions.priceRange.max);
        } else {
            // URL prices are now applied; subsequent loads may reset freely
            hadPriceInUrl.current = false;
        }
    }, [filterOptions.priceRange.min, filterOptions.priceRange.max]);

    /* ── Price slider ── */
    const sliderRef = useRef(null);
    const draggingRef = useRef(null);
    const priceMax = filterOptions.priceRange.max || 500;

    const handleSliderMouseDown = useCallback((e, thumb) => {
        e.preventDefault();
        draggingRef.current = thumb;
    }, []);

    const handleSliderMouseMove = useCallback((e) => {
        if (!draggingRef.current || !sliderRef.current) return;
        const rect = sliderRef.current.getBoundingClientRect();
        let pct = (e.clientX - rect.left) / rect.width;
        pct = Math.max(0, Math.min(1, pct));
        const priceMin = filterOptions.priceRange.min;
        const val = Math.round(priceMin + pct * (priceMax - priceMin));
        if (draggingRef.current === 'min') setPendingMinPrice(Math.max(priceMin, Math.min(val, pendingMaxPrice - 1)));
        else setPendingMaxPrice(Math.min(priceMax, Math.max(val, pendingMinPrice + 1)));
    }, [pendingMinPrice, pendingMaxPrice, priceMax, filterOptions.priceRange.min]);

    const handleSliderMouseUp = useCallback(() => { draggingRef.current = null; }, []);

    useEffect(() => {
        const handleTouchMove = (e) => { if (e.touches[0]) handleSliderMouseMove(e.touches[0]); };
        document.addEventListener('mousemove', handleSliderMouseMove);
        document.addEventListener('mouseup', handleSliderMouseUp);
        document.addEventListener('touchmove', handleTouchMove, { passive: true });
        document.addEventListener('touchend', handleSliderMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleSliderMouseMove);
            document.removeEventListener('mouseup', handleSliderMouseUp);
            document.removeEventListener('touchmove', handleTouchMove);
            document.removeEventListener('touchend', handleSliderMouseUp);
        };
    }, [handleSliderMouseMove, handleSliderMouseUp]);

    /* ── Filter actions ── */
    const toggleCollapse = (id) => setCollapsed((prev) => ({ ...prev, [id]: !prev[id] }));

    const togglePending = (setter, value) => {
        setter((prev) => prev.includes(value) ? prev.filter((v) => v !== value) : [...prev, value]);
    };

    const confirmFilters = () => {
        setAppliedForms([...pendingForms]);
        setAppliedRoutes([...pendingRoutes]);
        setAppliedRx([...pendingRx]);
        setAppliedSources([...pendingSources]);
        setAppliedHam([...pendingHam]);
        setAppliedMinPrice(pendingMinPrice);
        setAppliedMaxPrice(pendingMaxPrice);
        setCurrentPage(1);
        setFilterDrawerOpen(false);
        showToast('Filters applied');
        hadPriceInUrl.current = pendingMinPrice !== filterOptions.priceRange.min || pendingMaxPrice !== filterOptions.priceRange.max;
        setSearchParams((prev) => {
            const next = new URLSearchParams();
            const q = prev.get('q');
            if (q) next.set('q', q);
            pendingForms.forEach((f) => next.append('forms', f));
            pendingRoutes.forEach((r) => next.append('routes', r));
            pendingRx.forEach((r) => next.append('rx', r));
            pendingSources.forEach((s) => next.append('sources', s));
            pendingHam.forEach((h) => next.append('ham', h));
            if (pendingMinPrice !== filterOptions.priceRange.min) next.set('minPrice', pendingMinPrice);
            if (pendingMaxPrice !== filterOptions.priceRange.max) next.set('maxPrice', pendingMaxPrice);
            if (sortBy !== 'relevance') next.set('sort', sortBy);
            return next;
        }, { replace: true });
    };

    const clearFilters = () => {
        setPendingForms([]); setPendingRoutes([]); setPendingRx([]); setPendingSources([]); setPendingHam([]);
        setPendingMinPrice(filterOptions.priceRange.min); setPendingMaxPrice(filterOptions.priceRange.max);
        setAppliedForms([]); setAppliedRoutes([]); setAppliedRx([]); setAppliedSources([]); setAppliedHam([]);
        setAppliedMinPrice(filterOptions.priceRange.min); setAppliedMaxPrice(filterOptions.priceRange.max);
        setSortBy('relevance');
        setCurrentPage(1);
        hadPriceInUrl.current = false;
        showToast('Filters cleared');
        setSearchParams((prev) => {
            const next = new URLSearchParams();
            const q = prev.get('q');
            if (q) next.set('q', q);
            return next;
        }, { replace: true });
    };

    const hasPendingChanges = useMemo(() => {
        return JSON.stringify([pendingForms, pendingRoutes, pendingRx, pendingSources, pendingHam, pendingMinPrice, pendingMaxPrice])
            !== JSON.stringify([appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam, appliedMinPrice, appliedMaxPrice]);
    }, [pendingForms, pendingRoutes, pendingRx, pendingSources, pendingHam, pendingMinPrice, pendingMaxPrice,
        appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam, appliedMinPrice, appliedMaxPrice]);

    const activeFilterCount = [appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam]
        .reduce((n, arr) => n + arr.length, 0)
        + (appliedMinPrice > filterOptions.priceRange.min || appliedMaxPrice < filterOptions.priceRange.max ? 1 : 0);

    /* ── Client-side filtering using APPLIED state ── */
    const filteredDrugs = useMemo(() => {
        let result = [...drugs];

        if (appliedForms.length > 0) {
            result = result.filter((d) => {
                const forms = allDosageForms(d);
                return appliedForms.some((f) => forms.includes(f));
            });
        }
        if (appliedRoutes.length > 0) {
            result = result.filter((d) => {
                const routes = allRoutes(d);
                return appliedRoutes.some((r) => routes.includes(r));
            });
        }
        if (appliedRx.length > 0) {
            result = result.filter((d) => appliedRx.includes(displayRxStatus(d)));
        }
        if (appliedSources.length > 0) {
            result = result.filter((d) => appliedSources.includes(displaySource(d).toLowerCase()));
        }
        if (appliedHam.length > 0) {
            result = result.filter((d) => appliedHam.includes(displayHam(d)));
        }
        // Price filter
        result = result.filter((d) => {
            if (!hasPrice(d)) return true; // show drugs without price
            const p = Number(d.price);
            return p >= appliedMinPrice && p <= appliedMaxPrice;
        });

        if (sortBy === 'price-asc') result.sort((a, b) => (getPrice(a) || 0) - (getPrice(b) || 0));
        else if (sortBy === 'price-desc') result.sort((a, b) => (getPrice(b) || 0) - (getPrice(a) || 0));
        else if (sortBy === 'name') result.sort((a, b) => (displayName(a)).localeCompare(displayName(b)));

        return result;
    }, [drugs, appliedForms, appliedRoutes, appliedRx, appliedSources, appliedHam, appliedMinPrice, appliedMaxPrice, sortBy]);

    const totalPages = Math.ceil(filteredDrugs.length / CARDS_PER_PAGE);
    const activePage = Math.max(1, Math.min(currentPage, Math.max(totalPages, 1)));
    const start = (activePage - 1) * CARDS_PER_PAGE;
    const pageItems = filteredDrugs.slice(start, start + CARDS_PER_PAGE);
    const fromCount = filteredDrugs.length === 0 ? 0 : start + 1;
    const toCount = filteredDrugs.length === 0 ? 0 : Math.min(start + CARDS_PER_PAGE, filteredDrugs.length);

    const drugId = (d) => d.drug_id || d.id;

    const toggleSave = async (drug) => {
        try {
            const id = drugId(drug);
            if (savedIdSet.has(id)) {
                await removeItem(id);
                showToast('Removed from saved items');
                return;
            }
            await saveItem({
                id,
                brand_names: drug.brand_names || '',
                generic_name: drug.generic_name || drug.display_name || drug.name || 'Unknown',
                route: `/drug/${id}`,
                classes: drug.classes || [],
                rx: drug.rx_status || drug.rx || '',
                price: getPrice(drug),
                dosage_form: firstDosageForm(drug),
                ham: drug.ham,
                has_fda: drug.has_fda,
            });
            showToast('Saved to your list');
        } catch (error) {
            showToast(error.message || 'Failed to update saved items');
        }
    };

    /* ── Reusable filter card renderer ── */
    const renderFilterCard = (id, title, options, pendingArr, setPendingArr) => {
        if (options.length === 0) return null;
        return (
            <div className={`sr-filter-card ${collapsed[id] ? 'collapsed' : ''}`}>
                <div className="sr-filter-header" onClick={() => toggleCollapse(id)}>
                    <h3>{title}</h3>
                    {pendingArr.length > 0 && <span className="sr-filter-count">{pendingArr.length}</span>}
                    <div className="sr-filter-chevron">
                        <svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                    </div>
                </div>
                <div className="sr-filter-body">
                    {options.map(({ value, count }) => (
                        <label key={value} className="sr-check-label">
                            <input type="checkbox" checked={pendingArr.includes(value)} onChange={() => togglePending(setPendingArr, value)} />
                            <span className="sr-custom-check"></span>
                            <span className="sr-filter-option-text">{titleCase(value)}</span>
                            <span className="sr-filter-option-count">({count})</span>
                        </label>
                    ))}
                </div>
            </div>
        );
    };

    return (
        <div className="search-results-page">
            <SearchHeader initialSearchQuery={queryTerm} />

            <div className="sr-breadcrumb">
                <div className="sr-breadcrumb-inner">
                    <Link to="/">Home</Link>
                    <span className="sep">›</span>
                    <span className="current">Search Results</span>
                </div>
            </div>

            <main className="sr-main">
                <aside className="sr-aside">
                    {/* Dynamic Dosage Form Filter */}
                    {renderFilterCard('formFilter', 'Dosage Form', filterOptions.forms, pendingForms, setPendingForms)}

                    {/* Dynamic Route Filter */}
                    {renderFilterCard('routeFilter', 'Route of Administration', filterOptions.routes, pendingRoutes, setPendingRoutes)}

                    {/* Price Range */}
                    {drugs.some((d) => hasPrice(d)) && (
                        <div className={`sr-filter-card ${collapsed.priceFilter ? 'collapsed' : ''}`}>
                            <div className="sr-filter-header" onClick={() => toggleCollapse('priceFilter')}>
                                <h3>Price Range</h3>
                                <div className="sr-filter-chevron">
                                    <svg width="12" height="8" viewBox="0 0 12 8" fill="none"><path d="M1 1l5 5 5-5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /></svg>
                                </div>
                            </div>
                            <div className="sr-price-range-wrap sr-filter-body" style={{ borderTop: 0 }}>
                                <div className="sr-range-slider" ref={sliderRef}>
                                    <div className="sr-range-fill" style={{ left: `${((pendingMinPrice - filterOptions.priceRange.min) / (priceMax - filterOptions.priceRange.min || 1)) * 100}%`, right: `${100 - ((pendingMaxPrice - filterOptions.priceRange.min) / (priceMax - filterOptions.priceRange.min || 1)) * 100}%` }}></div>
                                    <div className="sr-range-thumb" style={{ left: `${((pendingMinPrice - filterOptions.priceRange.min) / (priceMax - filterOptions.priceRange.min || 1)) * 100}%` }}
                                        onMouseDown={(e) => handleSliderMouseDown(e, 'min')} onTouchStart={(e) => handleSliderMouseDown(e, 'min')} />
                                    <div className="sr-range-thumb" style={{ left: `${((pendingMaxPrice - filterOptions.priceRange.min) / (priceMax - filterOptions.priceRange.min || 1)) * 100}%` }}
                                        onMouseDown={(e) => handleSliderMouseDown(e, 'max')} onTouchStart={(e) => handleSliderMouseDown(e, 'max')} />
                                </div>
                                <div className="sr-price-inputs">
                                    <div className="sr-price-input-wrap">
                                        <label>Min</label>
                                        <div className="sr-input-with-symbol">
                                            <span>$</span>
                                            <input type="number" value={pendingMinPrice} onChange={(e) => setPendingMinPrice(Math.max(filterOptions.priceRange.min, Math.min(Number(e.target.value), pendingMaxPrice - 1)))} />
                                        </div>
                                    </div>
                                    <div className="sr-price-input-wrap">
                                        <label>Max</label>
                                        <div className="sr-input-with-symbol">
                                            <span>$</span>
                                            <input type="number" value={pendingMaxPrice} onChange={(e) => setPendingMaxPrice(Math.min(priceMax, Math.max(Number(e.target.value), pendingMinPrice + 1)))} />
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Dynamic Rx Status Filter */}
                    {renderFilterCard('rxFilter', 'Rx Status', filterOptions.rxStatuses, pendingRx, setPendingRx)}

                    {/* Dynamic HAM Filter */}
                    {renderFilterCard('hamFilter', 'High Alert Medication', filterOptions.hamValues, pendingHam, setPendingHam)}

                    {/* Dynamic Source Filter */}
                    {renderFilterCard('sourceFilter', 'Source', filterOptions.sources, pendingSources, setPendingSources)}

                    {/* ── Confirm / Clear buttons ── */}
                    <div className="sr-filter-actions">
                        <button className={`sr-confirm-filters-btn ${hasPendingChanges ? 'sr-confirm-highlight' : ''}`} onClick={confirmFilters} disabled={!hasPendingChanges}>
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><path d="m5 13 4 4L19 7" /></svg>
                            Confirm Filters
                        </button>
                        <button className="sr-clear-filters-btn" onClick={clearFilters} disabled={activeFilterCount === 0 && !hasPendingChanges}>
                            Clear All{activeFilterCount > 0 ? ` (${activeFilterCount})` : ''}
                        </button>
                    </div>
                </aside>

                {/* RESULTS */}
                <section className="sr-results-section">
                    <div className="sr-results-header">
                        <div>
                            <h1 className="sr-results-title">Results for '{queryTerm || 'All'}'</h1>
                            <div className="sr-results-count">
                                {apiLoading ? 'Searching...' : `Showing ${fromCount}–${toCount} of ${filteredDrugs.length} results`}
                                {activeFilterCount > 0 && !apiLoading && <span className="sr-active-filter-badge">{activeFilterCount} filter{activeFilterCount > 1 ? 's' : ''} active</span>}
                            </div>
                        </div>
                        <div className="sr-results-header-actions">
                            <button type="button" className="sr-mobile-filter-btn" onClick={() => setFilterDrawerOpen(true)} aria-label="Open filters">
                                <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h10" /></svg>
                                Filter
                                {activeFilterCount > 0 && <span className="sr-mobile-filter-count">{activeFilterCount}</span>}
                            </button>
                            <div className="sr-sort-controls">
                                <span>Sort by:</span>
                                <select className="sr-sort-select" value={sortBy} onChange={(e) => {
                                    const val = e.target.value;
                                    setSortBy(val);
                                    setCurrentPage(1);
                                    setSearchParams((prev) => {
                                        const next = new URLSearchParams(prev);
                                        if (val === 'relevance') next.delete('sort');
                                        else next.set('sort', val);
                                        return next;
                                    }, { replace: true });
                                }}>
                                    <option value="relevance">Relevance</option>
                                    <option value="price-asc">Price: Low to High</option>
                                    <option value="price-desc">Price: High to Low</option>
                                    <option value="name">Name A–Z</option>
                                </select>
                            </div>
                        </div>
                    </div>

                    {apiError && (
                        <div className="sr-no-results" style={{ display: 'block', color: '#ef4444' }}>
                            <h3>Error loading results</h3>
                            <p>{apiError}</p>
                        </div>
                    )}

                    {apiLoading ? (
                        <div className="sr-no-results" style={{ display: 'block' }}>
                            <div className="auth-btn__spinner" style={{ width: 32, height: 32, borderWidth: 3, margin: '0 auto' }}></div>
                            <p>Searching medications...</p>
                        </div>
                    ) : filteredDrugs.length > 0 ? (
                        <>
                            <div className="sr-cards-list">
                                {pageItems.map((d, i) => (
                                    <article key={drugId(d) || i} className="sr-drug-card" style={{ animationDelay: `${i * 0.06}s` }}>
                                        <div className="sr-card-desktop">
                                            <div className="sr-card-img" style={{ backgroundImage: 'linear-gradient(135deg, #eff6ff 0%, #f1f5f9 100%)' }}>
                                                <img src={getDosageFormIcon(firstDosageForm(d))} alt={firstDosageForm(d) || 'drug'} style={{ width: 56, height: 56, objectFit: 'contain', opacity: 0.75 }} />
                                            </div>
                                            <div className="sr-card-body">
                                                <div className="sr-card-top">
                                                    <div>
                                                        <div className="sr-card-title-row">
                                                            <span className="sr-card-title">{displayGenericName(d)}</span>
                                                            {isMedScapeSource(d) && (
                                                                <span className="sr-badge sr-badge-trusted">
                                                                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="m5 13 4 4L19 7" /></svg>
                                                                    Verified
                                                                </span>
                                                            )}
                                                            {d.has_fda && (
                                                                <span className="sr-badge sr-badge-trusted">FDA</span>
                                                            )}
                                                        </div>
                                                        {displayTradeName(d) && displayTradeName(d) !== displayGenericName(d) && (
                                                            <div className="sr-card-subtitle">{displayTradeName(d)}</div>
                                                        )}
                                                        <div className="sr-card-meta">
                                                            <div className="sr-card-meta-row"><span>Source:</span> <strong>{displaySource(d)}</strong></div>
                                                            {displayRxStatus(d) && <div className="sr-card-meta-row"><span>RX Status:</span> <strong>{displayRxStatus(d)}</strong></div>}
                                                            {displayHam(d) && <div className="sr-card-meta-row"><span>HAM:</span> <strong>{displayHam(d)}</strong></div>}
                                                            {hasPrice(d) && <div className="sr-card-meta-row"><span>Price:</span> <strong>${displayPrice(d)}</strong></div>}
                                                        </div>
                                                    </div>
                                                    <button className={`sr-save-btn ${savedIdSet.has(drugId(d)) ? 'saved' : ''}`} onClick={() => toggleSave(d)} title={savedIdSet.has(drugId(d)) ? 'Remove from saved' : 'Save item'}>
                                                        <svg width="16" height="20" fill={savedIdSet.has(drugId(d)) ? 'currentColor' : 'none'} viewBox="0 0 24 24">
                                                            <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 3h14a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                                                        </svg>
                                                    </button>
                                                </div>
                                                <div className="sr-card-footer">
                                                    <div className="sr-card-footer-spacer" aria-hidden="true" />
                                                    <Link to={`/drug/${drugId(d)}`} className="sr-btn-view-primary">View Details <svg width="10" height="10" fill="white" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" d="M7 17L17 7M17 7H7M17 7v10" /></svg></Link>
                                                </div>
                                            </div>
                                        </div>
                                        <div className="sr-card-mobile">
                                            <div className="sr-card-mobile-header">
                                                <div>
                                                    <h3 className="sr-card-mobile-title">{displayGenericName(d)}</h3>
                                                    {displayTradeName(d) && displayTradeName(d) !== displayGenericName(d) && (
                                                        <div className="sr-card-subtitle">{displayTradeName(d)}</div>
                                                    )}
                                                </div>
                                                <button className={`sr-save-btn ${savedIdSet.has(drugId(d)) ? 'saved' : ''}`} onClick={() => toggleSave(d)} aria-label="Save">
                                                    <svg width="14" height="18" fill={savedIdSet.has(drugId(d)) ? 'currentColor' : 'none'} viewBox="0 0 24 24">
                                                        <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 3h14a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                                                    </svg>
                                                </button>
                                            </div>
                                            {isMedScapeSource(d) && (
                                                <span className="sr-badge sr-badge-trusted sr-mobile-verified">
                                                    <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="m5 13 4 4L19 7" /></svg>
                                                    Verified
                                                </span>
                                            )}
                                            {d.has_fda && (
                                                <span className="sr-badge sr-badge-trusted sr-mobile-verified">FDA</span>
                                            )}
                                            <div className="sr-card-meta">
                                                <div className="sr-card-meta-row"><span>Source:</span> <strong>{displaySource(d)}</strong></div>
                                                {displayRxStatus(d) && <div className="sr-card-meta-row"><span>RX Status:</span> <strong>{displayRxStatus(d)}</strong></div>}
                                                {displayHam(d) && <div className="sr-card-meta-row"><span>HAM:</span> <strong>{displayHam(d)}</strong></div>}
                                                {hasPrice(d) && <div className="sr-card-meta-row"><span>Price:</span> <strong>${displayPrice(d)}</strong></div>}
                                            </div>
                                            <div className="sr-card-mobile-footer">
                                                <div className="sr-card-footer-spacer" aria-hidden="true" />
                                                <Link to={`/drug/${drugId(d)}`} className="sr-btn-view-primary sr-btn-mobile">View Details</Link>
                                            </div>
                                        </div>
                                    </article>
                                ))}
                            </div>

                            {totalPages > 1 && (
                                <div className="sr-pagination">
                                    <button className="sr-page-btn" disabled={activePage === 1} onClick={() => { setCurrentPage((p) => Math.max(1, p - 1)); window.scrollTo(0, 0); }}>
                                        <svg width="6" height="10" fill="none"><path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="m5 1-4 4 4 4" /></svg>
                                    </button>
                                    {Array.from({ length: totalPages }).map((_, i) => {
                                        const p = i + 1;
                                        if (p === 1 || p === totalPages || Math.abs(p - activePage) <= 1) {
                                            return <button key={p} className={`sr-page-btn ${p === activePage ? 'active' : ''}`} onClick={() => { setCurrentPage(p); window.scrollTo(0, 0); }}>{p}</button>;
                                        } else if (Math.abs(p - activePage) === 2) {
                                            return <span key={p} className="sr-page-dots">…</span>;
                                        }
                                        return null;
                                    })}
                                    <button className="sr-page-btn" disabled={activePage === totalPages || totalPages === 0} onClick={() => { setCurrentPage((p) => Math.min(Math.max(totalPages, 1), p + 1)); window.scrollTo(0, 0); }}>
                                        <svg width="6" height="10" fill="none"><path stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" d="m1 1 4 4-4 4" /></svg>
                                    </button>
                                </div>
                            )}
                        </>
                    ) : !apiError && (
                        <div className="sr-no-results" style={{ display: 'block' }}>
                            <svg width="64" height="64" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" /><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="m16.5 16.5 3.5 3.5" /><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M8.5 11h5M11 8.5v5" /></svg>
                            <h3>No results found</h3>
                            <p>Try adjusting your filters or search a different term.</p>
                        </div>
                    )}
                </section>
            </main>

            {/* ══════ Mobile Filter Drawer (Bottom Sheet) ══════ */}
            <div className={`sr-filter-overlay ${filterDrawerOpen ? 'open' : ''}`} onClick={() => setFilterDrawerOpen(false)} aria-hidden={!filterDrawerOpen} />
            <div className={`sr-filter-drawer ${filterDrawerOpen ? 'open' : ''}`} role="dialog" aria-label="Filter results">
                <div className="sr-filter-drawer-handle" />
                <div className="sr-filter-drawer-header">
                    <div className="sr-filter-drawer-title">
                        <svg width="18" height="18" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M4 6h16M4 12h16M4 18h10" /></svg>
                        Filter Results
                    </div>
                    <button type="button" className="sr-filter-drawer-clear" onClick={clearFilters}>Clear All</button>
                </div>
                <div className="sr-filter-drawer-body">
                    {/* Mobile: Dosage Form chips */}
                    {filterOptions.forms.length > 0 && (
                        <div className="sr-filter-drawer-section">
                            <h4 className="sr-filter-drawer-section-title">Dosage Form</h4>
                            <div className="sr-filter-drawer-chips">
                                {filterOptions.forms.map(({ value, count }) => (
                                    <button key={value} type="button"
                                        className={`sr-filter-chip ${pendingForms.includes(value) ? 'active' : ''}`}
                                        onClick={() => togglePending(setPendingForms, value)}>
                                        {titleCase(value)} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Mobile: Route chips */}
                    {filterOptions.routes.length > 0 && (
                        <div className="sr-filter-drawer-section">
                            <h4 className="sr-filter-drawer-section-title">Route of Administration</h4>
                            <div className="sr-filter-drawer-chips">
                                {filterOptions.routes.map(({ value, count }) => (
                                    <button key={value} type="button"
                                        className={`sr-filter-chip ${pendingRoutes.includes(value) ? 'active' : ''}`}
                                        onClick={() => togglePending(setPendingRoutes, value)}>
                                        {titleCase(value)} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Mobile: Rx Status */}
                    {filterOptions.rxStatuses.length > 0 && (
                        <div className="sr-filter-drawer-section">
                            <h4 className="sr-filter-drawer-section-title">Rx Status</h4>
                            <div className="sr-filter-drawer-chips">
                                {filterOptions.rxStatuses.map(({ value, count }) => (
                                    <button key={value} type="button"
                                        className={`sr-filter-chip ${pendingRx.includes(value) ? 'active' : ''}`}
                                        onClick={() => togglePending(setPendingRx, value)}>
                                        {value} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Mobile: HAM */}
                    {filterOptions.hamValues.length > 0 && (
                        <div className="sr-filter-drawer-section">
                            <h4 className="sr-filter-drawer-section-title">High Alert Medication</h4>
                            <div className="sr-filter-drawer-chips">
                                {filterOptions.hamValues.map(({ value, count }) => (
                                    <button key={value} type="button"
                                        className={`sr-filter-chip ${pendingHam.includes(value) ? 'active' : ''}`}
                                        onClick={() => togglePending(setPendingHam, value)}>
                                        {value} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Mobile: Source */}
                    {filterOptions.sources.length > 0 && (
                        <div className="sr-filter-drawer-section">
                            <h4 className="sr-filter-drawer-section-title">Source</h4>
                            <div className="sr-filter-drawer-chips">
                                {filterOptions.sources.map(({ value, count }) => (
                                    <button key={value} type="button"
                                        className={`sr-filter-chip ${pendingSources.includes(value) ? 'active' : ''}`}
                                        onClick={() => togglePending(setPendingSources, value)}>
                                        {titleCase(value)} ({count})
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {/* Mobile: Price */}
                    {drugs.some((d) => hasPrice(d)) && (
                        <div className="sr-filter-drawer-section">
                            <h4 className="sr-filter-drawer-section-title">Price Range</h4>
                            <div className="sr-filter-drawer-price">
                                <div className="sr-filter-drawer-price-input">
                                    <label>Min price</label>
                                    <input type="number" value={pendingMinPrice} min={filterOptions.priceRange.min} max={priceMax} onChange={(e) => setPendingMinPrice(Math.max(filterOptions.priceRange.min, Number(e.target.value) || 0))} />
                                </div>
                                <div className="sr-filter-drawer-price-input">
                                    <label>Max price</label>
                                    <input type="number" value={pendingMaxPrice} min={filterOptions.priceRange.min} max={priceMax} onChange={(e) => setPendingMaxPrice(Math.min(priceMax, Number(e.target.value) || priceMax))} />
                                </div>
                            </div>
                        </div>
                    )}
                </div>
                <div className="sr-filter-drawer-footer">
                    <button type="button" className="sr-filter-drawer-apply" onClick={confirmFilters}>
                        Confirm Filters ({filteredDrugs.length} results)
                    </button>
                    <button type="button" className="sr-filter-drawer-cancel" onClick={() => setFilterDrawerOpen(false)}>
                        Cancel
                    </button>
                </div>
            </div>

            <Footer />
        </div>
    );
}
