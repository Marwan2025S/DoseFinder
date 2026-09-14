import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout';
import IssueStatusBadge from '../components/IssueStatusBadge';
import { formatIssueDate } from '../constants/issues';
import { useAuth } from '../contexts/AuthContext';
import { dashboardApi } from '../services/api';
import { canManageDrugCatalog, isPendingDoctor } from '../utils/doctorAccess';
import { getAssignedDoctorDisplay } from '../utils/doctorDisplay';
import { getDrugCatalogStatus } from '../utils/drugCatalogStatus';

const DEFAULT_SUMMARY = {
    metrics: {
        openIssues: 0,
        needsReviewDrugs: 0,
        visibleDrugs: 0,
        updatedThisWeek: 0,
    },
    openIssues: [],
    needsReviewDrugs: [],
    recentDrugs: [],
    generatedAt: null,
};

const PILL_SVG = (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
        <path d="m8.5 8.5 7 7" />
    </svg>
);

const ISSUE_SVG = (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
);

const METRIC_ICONS = {
    openIssues: ISSUE_SVG,
    needsReviewDrugs: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 9v4" />
            <path d="M12 17h.01" />
            <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z" />
        </svg>
    ),
    visibleDrugs: PILL_SVG,
    updatedThisWeek: (
        <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v6h-6" />
        </svg>
    ),
};

function formatNumber(value) {
    return new Intl.NumberFormat().format(Number(value || 0));
}

function parseMaybeDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatRelativeTime(value) {
    const date = parseMaybeDate(value);
    if (!date) return '-';

    const diffMs = Date.now() - date.getTime();
    if (!Number.isFinite(diffMs)) return '-';

    const diffSec = Math.max(0, Math.floor(diffMs / 1000));
    if (diffSec < 60) return 'Just now';

    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;

    const diffHr = Math.floor(diffMin / 60);
    if (diffHr < 24) return `${diffHr}h ago`;

    const diffDay = Math.floor(diffHr / 24);
    return `${diffDay}d ago`;
}

function formatBrandNames(value) {
    if (Array.isArray(value)) {
        const items = value.map((item) => String(item || '').trim()).filter(Boolean);
        return items.length ? items.join(', ') : 'No brand names listed';
    }

    const str = String(value ?? '').trim();
    if (!str) return 'No brand names listed';
    return str.replace(/\s*,\s*/g, ', ').replace(/\s+/g, ' ');
}

function getDrugName(drug) {
    return drug?.generic_name || drug?.display_name || drug?.name || 'Unknown medication';
}

function getDrugId(drug) {
    return drug?.drug_id ?? drug?.id ?? drug?.version_id;
}

function formatVersionLabel(value) {
    const version = Number(value);
    return Number.isFinite(version) && version > 0 ? `v${version}` : '-';
}

function MetricCard({ label, value, description, to, tone, icon }) {
    const content = (
        <>
            <span className={`triage-metric__icon triage-metric__icon--${tone}`} aria-hidden="true">
                {icon}
            </span>
            <span className="triage-metric__body">
                <span className="triage-metric__value">{formatNumber(value)}</span>
                <span className="triage-metric__label">{label}</span>
                <span className="triage-metric__description">{description}</span>
            </span>
        </>
    );

    if (!to) {
        return <div className="triage-metric">{content}</div>;
    }

    return (
        <Link to={to} className="triage-metric">
            {content}
        </Link>
    );
}

function EmptyState({ title, text, action }) {
    return (
        <div className="triage-empty">
            <strong>{title}</strong>
            <p>{text}</p>
            {action}
        </div>
    );
}

function DashboardSkeleton() {
    return (
        <div className="triage-loading" role="status" aria-live="polite" aria-busy="true">
            <div className="doctor-table-spinner" aria-hidden="true"></div>
            <span>Loading doctor dashboard...</span>
        </div>
    );
}

function DrugListItem({ drug, canManageDrugs, onEdit, compact = false }) {
    const drugId = getDrugId(drug);
    const assignedDoctor = getAssignedDoctorDisplay(drug);
    const catalogStatus = getDrugCatalogStatus(drug);

    return (
        <article className={`triage-drug ${compact ? 'triage-drug--compact' : ''}`}>
            <div className="triage-drug__main">
                <span className="triage-drug__icon" aria-hidden="true">{PILL_SVG}</span>
                <div className="triage-drug__text">
                    <Link to={`/drug/${drugId}`} className="triage-drug__name">
                        {getDrugName(drug)}
                    </Link>
                    <p className="triage-drug__meta">{formatBrandNames(drug.brand_names_list || drug.brand_names)}</p>
                </div>
            </div>
            <div className="triage-drug__details">
                <span className={`app-badge app-badge--${catalogStatus.tone}`}>{catalogStatus.label}</span>
                <span className="triage-drug__time">{formatRelativeTime(drug.updated_at ?? drug.updatedAt)}</span>
                {!compact && (
                    <span className="triage-drug__doctor">{assignedDoctor.label}</span>
                )}
            </div>
            {!compact && (
                <button
                    className="med-action-btn med-action-btn--edit"
                    type="button"
                    title={canManageDrugs ? 'Edit medication' : 'Doctor approval pending'}
                    aria-label={`Edit ${getDrugName(drug)}`}
                    disabled={!canManageDrugs}
                    onClick={() => onEdit(drugId)}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                        <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4Z" />
                    </svg>
                </button>
            )}
        </article>
    );
}

function IssueListItem({ issue }) {
    return (
        <Link to={`/issues/${issue.id}`} className="triage-issue">
            <span className="triage-issue__icon" aria-hidden="true">{ISSUE_SVG}</span>
            <span className="triage-issue__body">
                <span className="triage-issue__topline">
                    <strong>{issue.drugName || 'Unknown medication'}</strong>
                    <IssueStatusBadge status={issue.status} />
                </span>
                <span className="triage-issue__part">{issue.partLabel || 'Medication record'}</span>
                <span className="triage-issue__message">{issue.message}</span>
                <span className="triage-issue__meta">
                    <span>By {issue.reporter?.username || 'User'}</span>
                    <span>{formatRelativeTime(issue.createdAt)}</span>
                    <span>Reported {formatVersionLabel(issue.reportedVersionNumber)}</span>
                </span>
            </span>
        </Link>
    );
}

export default function Dashboard() {
    const { user } = useAuth();
    const navigate = useNavigate();
    const pendingDoctor = isPendingDoctor(user);
    const canManageDrugs = canManageDrugCatalog(user);

    const [summary, setSummary] = useState(DEFAULT_SUMMARY);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState('');

    const loadDashboard = useCallback(async () => {
        if (!canManageDrugs) {
            setSummary(DEFAULT_SUMMARY);
            setLoading(false);
            setError('');
            return;
        }

        setLoading(true);
        setError('');

        try {
            const data = await dashboardApi.getDoctorSummary();
            setSummary({
                ...DEFAULT_SUMMARY,
                ...data,
                metrics: {
                    ...DEFAULT_SUMMARY.metrics,
                    ...(data?.metrics || {}),
                },
            });
        } catch (err) {
            setSummary(DEFAULT_SUMMARY);
            setError(err.message || 'Failed to load doctor dashboard');
        } finally {
            setLoading(false);
        }
    }, [canManageDrugs]);

    useEffect(() => {
        loadDashboard();
    }, [loadDashboard]);

    const metrics = summary.metrics || DEFAULT_SUMMARY.metrics;
    const metricCards = useMemo(() => [
        {
            key: 'openIssues',
            label: 'Open issues',
            value: metrics.openIssues,
            description: 'User reports waiting for review',
            to: '/issues',
            tone: 'urgent',
            icon: METRIC_ICONS.openIssues,
        },
        {
            key: 'needsReviewDrugs',
            label: 'Needs review',
            value: metrics.needsReviewDrugs,
            description: 'Visible medications flagged by admins',
            to: '/medications',
            tone: 'warning',
            icon: METRIC_ICONS.needsReviewDrugs,
        },
        {
            key: 'visibleDrugs',
            label: 'Visible drugs',
            value: metrics.visibleDrugs,
            description: 'Current medications available to doctors',
            to: '/medications',
            tone: 'catalog',
            icon: METRIC_ICONS.visibleDrugs,
        },
        {
            key: 'updatedThisWeek',
            label: 'Updated this week',
            value: metrics.updatedThisWeek,
            description: 'Current records changed in the last 7 days',
            to: '/medications',
            tone: 'fresh',
            icon: METRIC_ICONS.updatedThisWeek,
        },
    ], [metrics]);

    const generatedLabel = summary.generatedAt
        ? `Updated ${formatIssueDate(summary.generatedAt, { includeTime: true })}`
        : 'Live doctor queue';

    const handleEditDrug = (drugId) => {
        if (!drugId || !canManageDrugs) return;
        navigate(`/edit-drug/${drugId}`);
    };

    return (
        <AppLayout globalSearch>
            <main className="app-content app-content--triage-dashboard">
                <div className="dash-header triage-header">
                    <div>
                        <h1 className="dash-title">Doctor Triage</h1>
                        <p className="dash-subtitle">
                            Review the global medication work queue and act on the most urgent items first.
                        </p>
                    </div>
                    <div className="triage-header__actions">
                        <span className="triage-header__timestamp">{generatedLabel}</span>
                        {canManageDrugs ? (
                            <Link to="/add-drug" className="app-btn app-btn--primary">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
                                    <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
                                </svg>
                                Add Medication
                            </Link>
                        ) : (
                            <button type="button" className="app-btn app-btn--primary app-btn--disabled" disabled>
                                Add Medication
                            </button>
                        )}
                    </div>
                </div>

                {pendingDoctor && (
                    <>
                        <section className="doctor-approval-banner" aria-live="polite">
                            <strong className="doctor-approval-banner__title">Doctor approval pending</strong>
                            <p className="doctor-approval-banner__text">
                                Your triage queue will appear after your doctor account is approved. Medication changes and issue management are disabled for now.
                            </p>
                        </section>
                        <section className="triage-card">
                            <EmptyState
                                title="Workspace access is almost ready"
                                text="You can still browse medications, but the operational dashboard is reserved for approved doctor accounts."
                                action={<Link to="/medications" className="app-btn app-btn--secondary">Browse medications</Link>}
                            />
                        </section>
                    </>
                )}

                {!pendingDoctor && (
                    <>
                        {loading ? (
                            <DashboardSkeleton />
                        ) : error ? (
                            <section className="triage-card" aria-live="polite">
                                <EmptyState
                                    title="Dashboard could not load"
                                    text={error}
                                    action={<button type="button" className="app-btn app-btn--secondary" onClick={loadDashboard}>Retry</button>}
                                />
                            </section>
                        ) : (
                            <>
                                <section className="triage-metrics" aria-label="Doctor dashboard metrics">
                                    {metricCards.map((metric) => (
                                        <MetricCard key={metric.key} {...metric} />
                                    ))}
                                </section>

                                <div className="triage-grid">
                                    <section className="triage-card triage-card--primary" aria-labelledby="openIssuesTitle">
                                        <div className="triage-card__header">
                                            <div>
                                                <h2 className="triage-card__title" id="openIssuesTitle">Open Issues</h2>
                                                <p className="triage-card__subtitle">Newest user reports that need doctor review.</p>
                                            </div>
                                            <Link to="/issues" className="dash-card__view-all">View all</Link>
                                        </div>

                                        {summary.openIssues.length === 0 ? (
                                            <EmptyState
                                                title="No open issues"
                                                text="User-reported medication issues will appear here as soon as they are submitted."
                                            />
                                        ) : (
                                            <div className="triage-issue-list">
                                                {summary.openIssues.map((issue) => (
                                                    <IssueListItem key={issue.id} issue={issue} />
                                                ))}
                                            </div>
                                        )}
                                    </section>

                                    <section className="triage-card" aria-labelledby="reviewQueueTitle">
                                        <div className="triage-card__header">
                                            <div>
                                                <h2 className="triage-card__title" id="reviewQueueTitle">Needs Review</h2>
                                                <p className="triage-card__subtitle">Visible records flagged for doctor attention.</p>
                                            </div>
                                            <Link to="/medications" className="dash-card__view-all">Medication list</Link>
                                        </div>

                                        {summary.needsReviewDrugs.length === 0 ? (
                                            <EmptyState
                                                title="Review queue clear"
                                                text="Admin-flagged medication records will appear here when they need doctor review."
                                            />
                                        ) : (
                                            <div className="triage-drug-list">
                                                {summary.needsReviewDrugs.map((drug) => (
                                                    <DrugListItem
                                                        key={getDrugId(drug)}
                                                        drug={drug}
                                                        canManageDrugs={canManageDrugs}
                                                        onEdit={handleEditDrug}
                                                    />
                                                ))}
                                            </div>
                                        )}
                                    </section>
                                </div>

                                <section className="triage-card" aria-labelledby="recentChangesTitle">
                                    <div className="triage-card__header">
                                        <div>
                                            <h2 className="triage-card__title" id="recentChangesTitle">Recent Medication Changes</h2>
                                            <p className="triage-card__subtitle">Latest visible current records in the catalog.</p>
                                        </div>
                                        <Link to="/medications" className="dash-card__view-all">View medications</Link>
                                    </div>

                                    {summary.recentDrugs.length === 0 ? (
                                        <EmptyState
                                            title="No recent medication changes"
                                            text="Current medication updates will appear here."
                                        />
                                    ) : (
                                        <div className="triage-recent-grid">
                                            {summary.recentDrugs.map((drug) => (
                                                <DrugListItem
                                                    key={getDrugId(drug)}
                                                    drug={drug}
                                                    canManageDrugs={canManageDrugs}
                                                    onEdit={handleEditDrug}
                                                    compact
                                                />
                                            ))}
                                        </div>
                                    )}
                                </section>
                            </>
                        )}
                    </>
                )}
            </main>
        </AppLayout>
    );
}
