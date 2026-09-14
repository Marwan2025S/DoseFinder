import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import AppLayout from '../components/AppLayout';
import IssueStatusBadge from '../components/IssueStatusBadge';
import { useToast } from '../components/Toast';
import { ISSUE_FILTER_OPTIONS, formatIssueDate } from '../constants/issues';
import { issuesApi } from '../services/api';

function formatVersionLabel(versionNumber) {
    const version = Number(versionNumber);
    return Number.isFinite(version) && version > 0 ? `v${version}` : '—';
}

export default function Issues() {
    const navigate = useNavigate();
    const { issueId } = useParams();
    const { showToast } = useToast();

    const selectedIssueId = Number(issueId) || null;

    const [issues, setIssues] = useState([]);
    const [loadingList, setLoadingList] = useState(true);
    const [loadingDetail, setLoadingDetail] = useState(false);
    const [searchTerm, setSearchTerm] = useState('');
    const [statusFilter, setStatusFilter] = useState('open');
    const [detail, setDetail] = useState(null);
    const [replyMessage, setReplyMessage] = useState('');
    const [submittingAction, setSubmittingAction] = useState('');

    const loadIssues = useCallback(async () => {
        setLoadingList(true);
        try {
            const response = await issuesApi.list({
                status: statusFilter,
                q: searchTerm || undefined,
                page: 1,
                per_page: 50,
            });
            const nextIssues = Array.isArray(response?.issues) ? response.issues : [];
            setIssues(nextIssues);
            return nextIssues;
        } catch (error) {
            showToast(error.message || 'Failed to load issues');
            setIssues([]);
            return [];
        } finally {
            setLoadingList(false);
        }
    }, [searchTerm, showToast, statusFilter]);

    const loadIssueDetail = useCallback(async (targetIssueId) => {
        if (!targetIssueId) {
            setDetail(null);
            setReplyMessage('');
            return null;
        }

        setLoadingDetail(true);
        try {
            const response = await issuesApi.getDetails(targetIssueId);
            setDetail(response || null);
            setReplyMessage(response?.doctorReplyMessage || '');
            return response;
        } catch (error) {
            showToast(error.message || 'Failed to load issue details');
            setDetail(null);
            navigate('/issues', { replace: true });
            return null;
        } finally {
            setLoadingDetail(false);
        }
    }, [navigate, showToast]);

    useEffect(() => {
        loadIssues();
    }, [loadIssues]);

    useEffect(() => {
        if (!selectedIssueId) {
            setDetail(null);
            setReplyMessage('');
            return;
        }

        loadIssueDetail(selectedIssueId);
    }, [loadIssueDetail, selectedIssueId]);

    useEffect(() => {
        if (loadingList) {
            return;
        }

        if (issues.length === 0) {
            if (selectedIssueId) {
                navigate('/issues', { replace: true });
            }
            return;
        }

        const hasSelectedIssue = selectedIssueId && issues.some((issue) => issue.id === selectedIssueId);
        if (!hasSelectedIssue) {
            navigate(`/issues/${issues[0].id}`, { replace: true });
        }
    }, [issues, loadingList, selectedIssueId, navigate]);

    const summaryText = useMemo(() => {
        if (loadingList) return 'Loading issues...';
        if (issues.length === 0) return 'No issues match the current filters.';
        return `${issues.length} issue${issues.length === 1 ? '' : 's'} loaded`;
    }, [issues.length, loadingList]);

    const handleSelectIssue = (id) => {
        navigate(`/issues/${id}`);
    };

    const handleCloseIssue = async (withReply) => {
        if (!selectedIssueId) return;

        if (withReply && !replyMessage.trim()) {
            showToast('Write a reply before closing with a reply.');
            return;
        }

        setSubmittingAction(withReply ? 'reply-close' : 'close');
        try {
            await issuesApi.close(selectedIssueId, {
                replyMessage: withReply ? replyMessage.trim() : undefined,
            });
            showToast(withReply ? 'Issue replied to and closed.' : 'Issue closed.');
            await loadIssueDetail(selectedIssueId);
            await loadIssues();
        } catch (error) {
            showToast(error.message || 'Failed to close issue');
        } finally {
            setSubmittingAction('');
        }
    };

    const handleFixIssue = () => {
        if (!detail?.drugId || !detail?.id) return;
        navigate(`/edit-drug/${detail.drugId}?issueId=${detail.id}`);
    };

    return (
        <AppLayout onSearchChange={setSearchTerm} searchQuery={searchTerm}>
            <main className="app-content">
                <div className="med-page-header">
                    <div>
                        <h1 className="med-page-title">Issues</h1>
                        <p className="med-page-sub">Review user-reported medication problems and resolve them.</p>
                    </div>
                    <div className="issues-summary-chip">{summaryText}</div>
                </div>

                <div className="issues-filter-row">
                    <div className="issues-filter-group" role="tablist" aria-label="Issue filters">
                        {ISSUE_FILTER_OPTIONS.map((filter) => (
                            <button
                                key={filter.key}
                                type="button"
                                className={`issues-filter-btn ${statusFilter === filter.key ? 'issues-filter-btn--active' : ''}`}
                                onClick={() => setStatusFilter(filter.key)}
                            >
                                {filter.label}
                            </button>
                        ))}
                    </div>
                </div>

                <div className="issues-layout">
                    <section className="med-card issues-list-card" aria-label="Issues list">
                        <div className="issues-list-card__header">
                            <h2 className="issues-card-title">Reported Issues</h2>
                            <span className="issues-card-subtitle">Default view shows open items first.</span>
                        </div>

                        {loadingList ? (
                            <div className="issues-placeholder">
                                <div className="auth-btn__spinner" style={{ width: 24, height: 24, borderWidth: 2 }}></div>
                            </div>
                        ) : issues.length === 0 ? (
                            <div className="issues-placeholder">
                                <p>No issues found.</p>
                            </div>
                        ) : (
                            <div className="issues-list">
                                {issues.map((issue) => (
                                    <button
                                        key={issue.id}
                                        type="button"
                                        className={`issues-list-item ${issue.id === selectedIssueId ? 'issues-list-item--active' : ''}`}
                                        onClick={() => handleSelectIssue(issue.id)}
                                    >
                                        <div className="issues-list-item__top">
                                            <strong className="issues-list-item__title">{issue.drugName}</strong>
                                            <IssueStatusBadge status={issue.status} />
                                        </div>
                                        <p className="issues-list-item__part">{issue.partLabel}</p>
                                        <p className="issues-list-item__message">{issue.message}</p>
                                        <div className="issues-list-item__meta">
                                            <span>By {issue.reporter?.username || 'User'}</span>
                                            <span>{formatIssueDate(issue.createdAt)}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        )}
                    </section>

                    <section className="med-card issues-detail-card" aria-label="Issue details">
                        {!selectedIssueId ? (
                            <div className="issues-placeholder">
                                <p>Select an issue to inspect it.</p>
                            </div>
                        ) : loadingDetail ? (
                            <div className="issues-placeholder">
                                <div className="auth-btn__spinner" style={{ width: 24, height: 24, borderWidth: 2 }}></div>
                            </div>
                        ) : !detail ? (
                            <div className="issues-placeholder">
                                <p>Issue details are unavailable.</p>
                            </div>
                        ) : (
                            <div className="issues-detail">
                                <div className="issues-detail__header">
                                    <div>
                                        <h2 className="issues-card-title">{detail.drugName}</h2>
                                        <p className="issues-card-subtitle">{detail.partLabel}</p>
                                    </div>
                                    <IssueStatusBadge status={detail.status} />
                                </div>

                                <div className="issues-detail__meta-grid">
                                    <div className="issues-meta-item">
                                        <span className="issues-meta-item__label">Reporter</span>
                                        <strong>{detail.reporter?.username || 'User'}</strong>
                                        <span className="issues-meta-item__supporting">{detail.reporter?.email || 'No email available'}</span>
                                    </div>
                                    <div className="issues-meta-item">
                                        <span className="issues-meta-item__label">Reported</span>
                                        <strong>{formatIssueDate(detail.createdAt, { includeTime: true })}</strong>
                                    </div>
                                    <div className="issues-meta-item">
                                        <span className="issues-meta-item__label">Reported Version</span>
                                        <strong>{formatVersionLabel(detail.reportedVersionNumber)}</strong>
                                    </div>
                                    <div className="issues-meta-item">
                                        <span className="issues-meta-item__label">Current Version</span>
                                        <strong>{formatVersionLabel(detail.currentDrug?.versionNumber)}</strong>
                                    </div>
                                </div>

                                <div className="issues-section">
                                    <span className="issues-section__label">User message</span>
                                    <p className="issues-section__body">{detail.message}</p>
                                </div>

                                <div className="issues-section">
                                    <span className="issues-section__label">Doctor reply</span>
                                    {detail.doctorReplyMessage ? (
                                        <p className="issues-section__body">{detail.doctorReplyMessage}</p>
                                    ) : (
                                        <p className="issues-section__hint">No reply added yet.</p>
                                    )}
                                </div>

                                {detail.status === 'open' ? (
                                    <div className="issues-reply-box">
                                        <label className="issues-section__label" htmlFor="issueReplyMessage">Reply message</label>
                                        <textarea
                                            id="issueReplyMessage"
                                            className="issues-reply-box__textarea"
                                            rows={5}
                                            value={replyMessage}
                                            onChange={(event) => setReplyMessage(event.target.value)}
                                            placeholder="Optional note to send back to the reporting user."
                                            maxLength={1000}
                                        />
                                        <div className="issues-detail__actions">
                                            <button
                                                type="button"
                                                className="app-btn app-btn--secondary"
                                                onClick={() => handleCloseIssue(false)}
                                                disabled={submittingAction !== ''}
                                            >
                                                {submittingAction === 'close' ? 'Closing...' : 'Close'}
                                            </button>
                                            <button
                                                type="button"
                                                className="app-btn app-btn--secondary"
                                                onClick={() => handleCloseIssue(true)}
                                                disabled={submittingAction !== ''}
                                            >
                                                {submittingAction === 'reply-close' ? 'Closing...' : 'Reply and Close'}
                                            </button>
                                            <button
                                                type="button"
                                                className="app-btn app-btn--primary"
                                                onClick={handleFixIssue}
                                                disabled={submittingAction !== ''}
                                            >
                                                Fix with Update
                                            </button>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="issues-resolution-summary">
                                        <div className="issues-meta-item">
                                            <span className="issues-meta-item__label">Resolved by</span>
                                            <strong>{detail.resolvedBy?.username || '—'}</strong>
                                        </div>
                                        <div className="issues-meta-item">
                                            <span className="issues-meta-item__label">Resolved at</span>
                                            <strong>{formatIssueDate(detail.resolvedAt, { includeTime: true })}</strong>
                                        </div>
                                        <div className="issues-meta-item">
                                            <span className="issues-meta-item__label">Linked Version</span>
                                            <strong>{formatVersionLabel(detail.resolvedVersionNumber)}</strong>
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </section>
                </div>
            </main>
        </AppLayout>
    );
}
