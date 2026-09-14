import { useState } from 'react';
import { Link } from 'react-router-dom';

/**
 * Compact, foldable list of DoseFinder drug pages cited by a DoseGPT reply.
 * Rendered under the message text inside the AI bubble.
 */
export default function MessageSources({ sources }) {
    const [collapsed, setCollapsed] = useState(false);
    const validSources = Array.isArray(sources)
        ? sources.filter((source) => Number.isInteger(source?.id) && source.id > 0
            && typeof source?.name === 'string' && source.name.trim())
        : [];

    if (validSources.length === 0) return null;

    return (
        <div className={`cb-sources ${collapsed ? 'collapsed' : ''}`}>
            <button
                type="button"
                className="cb-sources-toggle"
                onClick={() => setCollapsed((prev) => !prev)}
                aria-expanded={!collapsed}
            >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
                    <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
                </svg>
                Sources
                <span className="cb-sources-count">{validSources.length}</span>
                <svg className="cb-sources-chevron" width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                </svg>
            </button>
            {!collapsed && (
                <div className="cb-sources-list">
                    {validSources.map((source) => (
                        <Link
                            key={source.id}
                            to={`/drug/${source.id}`}
                            className="cb-source-pill"
                            title={`Open ${source.name} in DoseFinder`}
                        >
                            <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                                <path d="m8.5 8.5 7 7" />
                            </svg>
                            <span className="cb-source-pill-name">{source.name}</span>
                        </Link>
                    ))}
                </div>
            )}
        </div>
    );
}
