import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { aiApi } from '../services/api';
import renderMarkdown from '../utils/renderMarkdown';
import MessageSources from '../components/MessageSources';
import '../styles/chatbot.css';

function Logo({ size = 28, color = '#13b6ec' }) {
    return (
        <svg width={size} height={size} viewBox="0 0 40 40" fill="none" aria-hidden="true">
            <rect x="0" y="0" width="16" height="16" fill={color} />
            <rect x="20" y="0" width="20" height="8" fill={color} />
            <rect x="20" y="12" width="20" height="8" fill={color} />
            <rect x="0" y="20" width="16" height="8" fill={color} />
            <rect x="0" y="32" width="16" height="8" fill={color} />
            <rect x="20" y="24" width="20" height="16" fill={color} />
        </svg>
    );
}

function getDisplaySender(role) {
    if (role === 'user') return 'user';
    if (role === 'system') return 'system';
    return 'ai';
}

function formatSharedDate(value) {
    if (!value) return '';
    const date = new Date(typeof value === 'string' ? value.replace(' ', 'T') : value);
    if (Number.isNaN(date.getTime())) return '';

    return date.toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
    });
}

async function copyCurrentUrl() {
    const url = window.location.href;

    if (navigator.clipboard?.writeText) {
        try {
            await navigator.clipboard.writeText(url);
            return;
        } catch {
            // Fall back to a temporary selection for browsers that expose
            // clipboard APIs but deny writes in the current context.
        }
    }

    const textarea = document.createElement('textarea');
    textarea.value = url;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.left = '-9999px';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, url.length);

    try {
        const copied = document.execCommand('copy');
        if (!copied) throw new Error('Copy command failed');
    } finally {
        document.body.removeChild(textarea);
    }
}

export default function SharedChat() {
    const { token } = useParams();
    const [sharedChatState, setSharedChatState] = useState({
        token: null,
        sharedChat: null,
        isLoading: true,
        error: '',
    });
    const [copyState, setCopyState] = useState('idle');

    useEffect(() => {
        let isMounted = true;

        aiApi.getSharedChat(token)
            .then((res) => {
                if (!isMounted) return;
                setSharedChatState({
                    token,
                    sharedChat: res?.data?.sharedChat ?? null,
                    isLoading: false,
                    error: '',
                });
            })
            .catch((err) => {
                if (!isMounted) return;
                setSharedChatState({
                    token,
                    sharedChat: null,
                    isLoading: false,
                    error: err?.status === 404 ? 'Shared chat not found' : 'Failed to load shared chat',
                });
            });

        return () => {
            isMounted = false;
        };
    }, [token]);

    const isCurrentToken = sharedChatState.token === token;
    const isLoading = !isCurrentToken || sharedChatState.isLoading;
    const sharedChat = isCurrentToken ? sharedChatState.sharedChat : null;
    const error = isCurrentToken ? sharedChatState.error : '';
    const messages = useMemo(
        () => (sharedChat?.messages ?? []).map((message) => ({
            ...message,
            sender: getDisplaySender(message.role),
        })),
        [sharedChat],
    );
    const sharedAt = formatSharedDate(sharedChat?.created_at);

    const handleCopyLink = async () => {
        setCopyState('copying');
        try {
            await copyCurrentUrl();
            setCopyState('copied');
            window.setTimeout(() => setCopyState('idle'), 1800);
        } catch {
            setCopyState('failed');
        }
    };

    return (
        <div className="shared-chat-page">
            <header className="shared-chat-header">
                <Link to="/" className="shared-chat-brand" aria-label="DoseFinder home">
                    <Logo size={26} />
                    <span>Dose<span>Finder</span></span>
                </Link>
                <button
                    type="button"
                    className="shared-chat-copy-btn"
                    onClick={handleCopyLink}
                    disabled={copyState === 'copying'}
                >
                    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <rect x="9" y="9" width="13" height="13" rx="2" />
                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                    </svg>
                    {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy link'}
                </button>
            </header>

            <main className="shared-chat-main">
                <section className="shared-chat-title-block">
                    <p className="shared-chat-kicker">Shared DoseGPT chat</p>
                    <h1>{sharedChat?.title || 'Shared conversation'}</h1>
                    {sharedAt && <p>Snapshot created {sharedAt}</p>}
                </section>

                <section className="shared-chat-transcript" aria-busy={isLoading}>
                    {isLoading ? (
                        <div className="shared-chat-state">Loading shared chat...</div>
                    ) : error ? (
                        <div className="shared-chat-state shared-chat-state-error">
                            <h2>{error}</h2>
                            <p>The link may be incorrect or the snapshot is no longer available.</p>
                        </div>
                    ) : messages.length === 0 ? (
                        <div className="shared-chat-state">This shared chat has no visible messages.</div>
                    ) : (
                        <div className="cb-messages-list shared-chat-messages">
                            {messages.map((msg) => (
                                msg.sender === 'system' ? (
                                    <div key={msg.id} className="cb-msg-row system">
                                        <div className="cb-system-card" role="status">
                                            <div className="cb-system-card-label">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <circle cx="12" cy="12" r="9" />
                                                    <path d="M12 8h.01" />
                                                    <path d="M11 12h1v4h1" />
                                                </svg>
                                                System notice
                                            </div>
                                            <div className="cb-msg-bubble cb-system-bubble">{renderMarkdown(msg.content)}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div key={msg.id} className={`cb-msg-row ${msg.sender}`}>
                                        {msg.sender === 'ai' && <div className="cb-msg-avatar cb-ai-avatar"><Logo size={14} color="#fff" /></div>}
                                        <div className={`cb-msg-bubble ${msg.sender === 'user' ? 'cb-user-bubble' : 'cb-ai-bubble'}`}>
                                            {msg.sender === 'user' ? msg.content : (
                                                <>
                                                    {renderMarkdown(msg.content)}
                                                    <MessageSources sources={msg.sources} />
                                                </>
                                            )}
                                        </div>
                                        {msg.sender === 'user' && <div className="cb-msg-avatar cb-user-msg-avatar">A</div>}
                                    </div>
                                )
                            ))}
                        </div>
                    )}
                </section>
            </main>
        </div>
    );
}
