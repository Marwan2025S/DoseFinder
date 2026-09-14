import { useState, useRef, useEffect, useMemo } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { aiApi } from '../services/api';
import renderMarkdown from '../utils/renderMarkdown';
import MessageSources from '../components/MessageSources';
import { getUserInitials, getUserDisplayName } from '../utils/userDisplay';
import '../styles/chatbot.css';

function parseStringArray(value) {
    if (Array.isArray(value)) {
        return value.map((item) => String(item ?? '').trim()).filter(Boolean);
    }
    if (typeof value !== 'string') return [];
    const raw = value.trim();
    if (!raw) return [];
    try {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
            return parsed.map((item) => String(item ?? '').trim()).filter(Boolean);
        }
        return [String(parsed ?? '').trim()].filter(Boolean);
    } catch {
        return raw.split(',').map((item) => item.trim()).filter(Boolean);
    }
}

function getDrugDisplayName(drugData) {
    const brandNames = parseStringArray(drugData?.brand_names);
    return drugData?.generic_name || drugData?.display_name || drugData?.name || brandNames[0] || 'N/A';
}

function getDrugForm(drugData) {
    const forms = Array.isArray(drugData?.dosage_forms) ? drugData.dosage_forms : [];
    return forms[0]?.form_name || drugData?.dosage_form || drugData?.form || 'N/A';
}

function buildContextMessage(drugId, drugData) {
    if (!drugId || !drugData) return null;
    const name = getDrugDisplayName(drugData);
    const brandNames = parseStringArray(drugData.brand_names).join(', ') || 'N/A';
    return `[SYSTEM CONTEXT - do not repeat this to the user]
You are DoseGPT inside DoseFinder.
You must answer strictly from DoseFinder data already available in this conversation or returned by DoseFinder tools.
Do not use outside medical knowledge or assumptions.
The user is currently viewing this drug - use it as your primary reference:

Drug ID   : ${drugId}
Name      : ${name}
Generic   : ${drugData.generic_name ?? drugData.generic ?? 'N/A'}
Brands    : ${brandNames}
Form      : ${getDrugForm(drugData)}
Price     : ${drugData.price ?? 'N/A'}

IMPORTANT: When calling any tool that requires a drugId, ALWAYS use: ${drugId}
Never use a different drugId unless the user explicitly asks about another drug.

Reply with a brief greeting mentioning "${name}", then wait for the user's question.`;
}

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

const TEMPORARY_CONTEXT_MAX_MESSAGES = 20;
const CHAT_DRAFT_PREVIEW_MAX_LENGTH = 96;
const NEW_CHAT_DRAFT_SCOPE = 'new';
const TEMPORARY_CHAT_DRAFT_SCOPE = 'temporary';

function isHiddenContextMessage(message) {
    return typeof message?.content === 'string' && message.content.startsWith('[SYSTEM CONTEXT');
}

function sanitizeDraftMap(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    return Object.fromEntries(
        Object.entries(value).filter(([key, draft]) => typeof key === 'string' && typeof draft === 'string' && draft.length > 0),
    );
}

function buildConversationDraftKey(conversationId) {
    return conversationId ? `conversation:${conversationId}` : null;
}

function buildScopedDraftKey(scope, contextKey) {
    return `${scope}:${contextKey}`;
}

function getDraftPreviewText(value) {
    if (typeof value !== 'string') return '';
    const normalized = value.replace(/\s+/g, ' ').trim();
    if (!normalized) return '';
    if (normalized.length <= CHAT_DRAFT_PREVIEW_MAX_LENGTH) return normalized;
    return `${normalized.slice(0, CHAT_DRAFT_PREVIEW_MAX_LENGTH - 3).trimEnd()}...`;
}

function getConversationDate(value) {
    if (!value) return null;
    const normalized = typeof value === 'string' ? value.replace(' ', 'T') : value;
    const date = new Date(normalized);
    return Number.isNaN(date.getTime()) ? null : date;
}

function formatConversationTimestamp(value) {
    const date = getConversationDate(value);
    if (!date) return '';

    const now = new Date();
    const diffMs = date.getTime() - now.getTime();
    const absDiffMs = Math.abs(diffMs);
    const minuteMs = 60 * 1000;
    const hourMs = 60 * minuteMs;
    const dayMs = 24 * hourMs;

    if (absDiffMs < minuteMs) return 'Just now';
    if (absDiffMs < hourMs) {
        const minutes = Math.max(1, Math.round(absDiffMs / minuteMs));
        return diffMs < 0 ? `${minutes} min ago` : `In ${minutes} min`;
    }
    if (absDiffMs < dayMs) {
        const hours = Math.max(1, Math.round(absDiffMs / hourMs));
        return diffMs < 0 ? `${hours} hr ago` : `In ${hours} hr`;
    }

    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const dateStart = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const dayDiff = Math.round((todayStart.getTime() - dateStart.getTime()) / dayMs);

    if (dayDiff === 1) return 'Yesterday';
    if (dayDiff === -1) return 'Tomorrow';
    if (dayDiff > 1 && dayDiff < 7) return `${dayDiff} days ago`;
    if (dayDiff < -1 && dayDiff > -7) return `In ${Math.abs(dayDiff)} days`;

    return date.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' } : {}),
    });
}

function trimTemporaryMessages(messages = []) {
    if (!Array.isArray(messages) || messages.length === 0) return [];
    if (messages.length <= TEMPORARY_CONTEXT_MAX_MESSAGES) return messages;
    if (!isHiddenContextMessage(messages[0])) {
        return messages.slice(-TEMPORARY_CONTEXT_MAX_MESSAGES);
    }
    return [
        messages[0],
        ...messages.slice(-(TEMPORARY_CONTEXT_MAX_MESSAGES - 1)),
    ];
}

function getDisplaySender(role) {
    if (role === 'user') return 'user';
    if (role === 'system') return 'system';
    return 'ai';
}

function toDisplayMessage(content, role = 'assistant', sources = []) {
    const normalizedContent = typeof content === 'string' ? content.trim() : '';
    const fallbackContent = role === 'assistant'
        ? 'DoseGPT did not return a response for this message. Please try again.'
        : normalizedContent;

    return {
        text: normalizedContent || fallbackContent,
        sender: getDisplaySender(role),
        sources: Array.isArray(sources) ? sources : [],
    };
}

export default function Chatbot({ drugId, drugData, initialPrompt, initialPromptKey }) {
    const { showToast } = useToast();
    const { user, logout } = useAuth();
    const navigate = useNavigate();

    const [conversationId, setConversationId] = useState(null);
    const [displayMessages, setDisplayMessages] = useState([]);
    const [temporaryConversationMessages, setTemporaryConversationMessages] = useState([]);
    const [input, setInput] = useState('');
    const [isTyping, setIsTyping] = useState(false);
    const [isInitializing, setIsInitializing] = useState(false);
    const [isLoadingConversation, setIsLoadingConversation] = useState(false);
    const [isTemporaryChat, setIsTemporaryChat] = useState(false);
    const [typingConversationIds, setTypingConversationIds] = useState([]);
    const [sidebarOpen, setSidebarOpen] = useState(false);
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [chatSearchQuery, setChatSearchQuery] = useState('');
    const [chatSearchResults, setChatSearchResults] = useState([]);
    const [chatSearchRefreshKey, setChatSearchRefreshKey] = useState(0);
    const [isSearchingChats, setIsSearchingChats] = useState(false);

    const [conversations, setConversations] = useState([]);
    const [openConversationMenuId, setOpenConversationMenuId] = useState(null);
    const [topbarMenuOpen, setTopbarMenuOpen] = useState(false);
    const [deleteTargetConv, setDeleteTargetConv] = useState(null);
    const [renameTargetConv, setRenameTargetConv] = useState(null);
    const [renameValue, setRenameValue] = useState('');
    const [sidebarProfileOpen, setSidebarProfileOpen] = useState(false);
    const [pinnedConversationIds, setPinnedConversationIds] = useState([]);
    const [conversationDrafts, setConversationDrafts] = useState({});
    const [draftsLoaded, setDraftsLoaded] = useState(false);
    const [sharingConversationIds, setSharingConversationIds] = useState([]);
    const [shareFallbackUrl, setShareFallbackUrl] = useState('');
    const [copiedMessageIdx, setCopiedMessageIdx] = useState(null);

    const storageNamespace = useMemo(() => user?.id ?? user?.username ?? user?.email ?? 'guest', [user]);
    const pinnedStorageKey = `dosefinder_chat_pins_${storageNamespace}`;
    const sidebarStorageKey = `dosefinder_chat_sidebar_collapsed_${storageNamespace}`;
    const draftsStorageKey = `dosefinder_chat_drafts_${storageNamespace}`;
    const draftContextKey = useMemo(() => (drugId ? `drug_${drugId}` : 'general'), [drugId]);
    const newConversationDraftKey = useMemo(
        () => buildScopedDraftKey(NEW_CHAT_DRAFT_SCOPE, draftContextKey),
        [draftContextKey],
    );
    const temporaryConversationDraftKey = useMemo(
        () => buildScopedDraftKey(TEMPORARY_CHAT_DRAFT_SCOPE, draftContextKey),
        [draftContextKey],
    );

    const chatAreaRef = useRef(null);
    const inputRef = useRef(null);
    const searchInputRef = useRef(null);
    const hasAutoSentPromptRef = useRef(false);
    const sendUserMessageRef = useRef(null);
    const chatSearchRequestIdRef = useRef(0);
    const copyMessageResetRef = useRef(null);
    const [activeConversationMeta, setActiveConversationMeta] = useState(null);

    const pinnedIdSet = useMemo(() => new Set(pinnedConversationIds), [pinnedConversationIds]);
    const conversationLookup = useMemo(() => {
        const merged = new Map();
        [...conversations, ...chatSearchResults].forEach((conv) => {
            if (!conv?.id) return;
            merged.set(conv.id, {
                ...(merged.get(conv.id) ?? {}),
                ...conv,
            });
        });
        return merged;
    }, [conversations, chatSearchResults]);
    const pinnedConversations = useMemo(
        () => pinnedConversationIds.map((id) => conversationLookup.get(id)).filter(Boolean),
        [pinnedConversationIds, conversationLookup],
    );
    const recentConversations = useMemo(
        () => conversations.filter((conv) => !pinnedIdSet.has(conv.id)),
        [conversations, pinnedIdSet],
    );
    const currentConversation = useMemo(() => {
        if (!conversationId) return null;
        return conversationLookup.get(conversationId) ?? activeConversationMeta ?? null;
    }, [conversationLookup, conversationId, activeConversationMeta]);
    const activeDraftKey = useMemo(() => {
        if (conversationId) return buildConversationDraftKey(conversationId);
        return isTemporaryChat ? temporaryConversationDraftKey : newConversationDraftKey;
    }, [conversationId, isTemporaryChat, newConversationDraftKey, temporaryConversationDraftKey]);
    const normalizedChatSearchQuery = chatSearchQuery.trim();
    const isChatSearchActive = normalizedChatSearchQuery.length > 0;
    const initialPromptConsumeKey = useMemo(() => {
        const prompt = initialPrompt?.trim();
        if (!prompt || !initialPromptKey) return null;
        return `dosefinder_chat_initial_prompt_consumed_${initialPromptKey}`;
    }, [initialPrompt, initialPromptKey]);
    const canManageCurrentConversation = Boolean(currentConversation && !isTemporaryChat);
    const currentPinned = currentConversation ? pinnedIdSet.has(currentConversation.id) : false;
    const isSharingCurrentConversation = currentConversation
        ? sharingConversationIds.includes(currentConversation.id)
        : false;
    const showTypingIndicator = isInitializing || (
        isTyping && (
            !conversationId || typingConversationIds.includes(conversationId)
        )
    );
    const drugName = drugData ? getDrugDisplayName(drugData) : '';
    const newConversationDraftPreview = getDraftPreviewText(conversationDrafts[newConversationDraftKey]);
    const showNewConversationDraftRow = Boolean(newConversationDraftPreview);
    const isGuestUser = !user || user?.role === 'guest';
    const userInitials = getUserInitials(user, 'P');
    const userDisplayName = getUserDisplayName(user, 'User');
    const userAccountType = user?.role === 'doctor'
        ? 'Doctor'
        : user?.role === 'admin'
            ? 'Admin'
            : user?.role === 'guest'
                ? 'Guest'
                : 'Member';
    const userApprovalStatus = user?.role === 'guest'
        ? 'Guest'
        : user?.role === 'doctor'
            ? (user?.verifiedDoctor ? 'Approved' : 'Pending')
            : (user?.emailVerified === false ? 'Pending' : 'Approved');
    const userProfileMeta = userAccountType === userApprovalStatus
        ? userAccountType
        : `${userAccountType} · ${userApprovalStatus}`;

    const refreshConversations = async () => {
        const res = await aiApi.getConversations(1, 20);
        const nextConversations = res?.data?.conversations ?? [];
        setConversations(nextConversations);
        if (conversationId) {
            const activeConversation = nextConversations.find((conv) => conv.id === conversationId);
            if (activeConversation) setActiveConversationMeta(activeConversation);
        }
    };

    const persistPinnedIds = (nextPinnedIds) => {
        setPinnedConversationIds(nextPinnedIds);
        localStorage.setItem(pinnedStorageKey, JSON.stringify(nextPinnedIds));
    };

    const resizeComposer = () => {
        if (!inputRef.current) return;
        inputRef.current.style.height = 'auto';
        inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 180)}px`;
    };

    const writeDraftsToStorage = (nextDrafts) => {
        try {
            const sanitizedDrafts = sanitizeDraftMap(nextDrafts);
            if (Object.keys(sanitizedDrafts).length > 0) {
                localStorage.setItem(draftsStorageKey, JSON.stringify(sanitizedDrafts));
            } else {
                localStorage.removeItem(draftsStorageKey);
            }
        } catch {
            // ignore storage failures
        }
    };

    const updateDraftValue = (draftKey, value) => {
        if (!draftKey) return;
        setConversationDrafts((prev) => {
            const nextDrafts = { ...prev };
            if (typeof value === 'string' && value.length > 0) {
                nextDrafts[draftKey] = value;
            } else {
                delete nextDrafts[draftKey];
            }
            writeDraftsToStorage(nextDrafts);
            return nextDrafts;
        });
    };

    const restoreComposerFromDraft = (draftKey, shouldFocus = false) => {
        const nextValue = draftKey ? (conversationDrafts[draftKey] ?? '') : '';
        setInput(nextValue);
        window.requestAnimationFrame(() => {
            resizeComposer();
            if (shouldFocus) inputRef.current?.focus();
        });
    };

    const clearComposer = () => {
        setInput('');
        resizeComposer();
    };

    const togglePinConversation = (convId) => {
        const isPinned = pinnedIdSet.has(convId);
        const nextPins = isPinned
            ? pinnedConversationIds.filter((id) => id !== convId)
            : [convId, ...pinnedConversationIds.filter((id) => id !== convId)];
        persistPinnedIds(nextPins);
        setOpenConversationMenuId(null);
        setTopbarMenuOpen(false);
    };

    const closeMenus = () => {
        setOpenConversationMenuId(null);
        setTopbarMenuOpen(false);
        setSidebarProfileOpen(false);
    };

    const resetCurrentChat = () => {
        setConversationId(null);
        setActiveConversationMeta(null);
        setDisplayMessages([]);
        setTemporaryConversationMessages([]);
        clearComposer();
        closeMenus();
    };

    const appendTemporaryAssistantMessage = (messages, assistantMessage) => {
        if (!assistantMessage?.content || assistantMessage.failed) {
            return trimTemporaryMessages(messages);
        }

        return trimTemporaryMessages([
            ...messages,
            {
                role: assistantMessage.role === 'assistant' ? 'assistant' : 'system',
                content: assistantMessage.content,
            },
        ]);
    };

    const requestChatSearchRefresh = () => {
        if (!chatSearchQuery.trim()) return;
        setChatSearchRefreshKey((prev) => prev + 1);
    };

    const focusChatSearch = () => {
        if (sidebarCollapsed) {
            setSidebarCollapsed(false);
            localStorage.setItem(sidebarStorageKey, '0');
        }
        setSidebarOpen(true);
        window.requestAnimationFrame(() => {
            searchInputRef.current?.focus();
        });
    };

    const clearChatSearch = () => {
        setChatSearchQuery('');
        setChatSearchResults([]);
        setIsSearchingChats(false);
        focusChatSearch();
    };

    useEffect(() => {
        if (chatAreaRef.current) chatAreaRef.current.scrollTop = chatAreaRef.current.scrollHeight;
    }, [displayMessages, isTyping, isInitializing]);

    useEffect(() => {
        let isMounted = true;

        aiApi.getConversations(1, 20)
            .then((res) => {
                if (!isMounted) return;
                const nextConversations = res?.data?.conversations ?? [];
                setConversations(nextConversations);
            })
            .catch(() => {});

        return () => {
            isMounted = false;
        };
    }, []);

    useEffect(() => {
        const requestId = ++chatSearchRequestIdRef.current;

        if (!normalizedChatSearchQuery) {
            setChatSearchResults([]);
            setIsSearchingChats(false);
            return undefined;
        }

        setIsSearchingChats(true);
        const timeoutId = window.setTimeout(async () => {
            try {
                const res = await aiApi.searchConversations(normalizedChatSearchQuery, 1, 50);
                if (chatSearchRequestIdRef.current !== requestId) return;
                setChatSearchResults(res?.data?.conversations ?? []);
            } catch {
                if (chatSearchRequestIdRef.current !== requestId) return;
                setChatSearchResults([]);
                showToast('Failed to search chats', 'error');
            } finally {
                if (chatSearchRequestIdRef.current === requestId) {
                    setIsSearchingChats(false);
                }
            }
        }, 220);

        return () => window.clearTimeout(timeoutId);
    }, [normalizedChatSearchQuery, chatSearchRefreshKey, showToast]);

    useEffect(() => {
        try {
            const rawPins = localStorage.getItem(pinnedStorageKey);
            if (rawPins) {
                const parsed = JSON.parse(rawPins);
                if (Array.isArray(parsed)) setPinnedConversationIds(parsed);
                else setPinnedConversationIds([]);
            }
            else {
                setPinnedConversationIds([]);
            }

            setSidebarCollapsed(localStorage.getItem(sidebarStorageKey) === '1');
        } catch {
            // ignore storage parse issues
            setPinnedConversationIds([]);
            setSidebarCollapsed(false);
        }
    }, [pinnedStorageKey, sidebarStorageKey]);

    useEffect(() => {
        setDraftsLoaded(false);
        try {
            const rawDrafts = localStorage.getItem(draftsStorageKey);
            if (rawDrafts) {
                const parsed = JSON.parse(rawDrafts);
                setConversationDrafts(sanitizeDraftMap(parsed));
            } else {
                setConversationDrafts({});
            }
        } catch {
            setConversationDrafts({});
        } finally {
            setDraftsLoaded(true);
        }
    }, [draftsStorageKey]);

    useEffect(() => {
        if (!draftsLoaded || isTyping || isInitializing || isLoadingConversation) return;
        const nextValue = activeDraftKey ? (conversationDrafts[activeDraftKey] ?? '') : '';
        setInput((prev) => (prev === nextValue ? prev : nextValue));
        const frame = window.requestAnimationFrame(() => {
            resizeComposer();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [activeDraftKey, conversationDrafts, draftsLoaded, isInitializing, isLoadingConversation, isTyping]);

    useEffect(() => {
        const onDocMouseDown = (event) => {
            const inMenu = event.target.closest('.cb-chat-more-menu, .cb-history-more-btn, .cb-topbar-menu-wrap, .cb-sidebar-profile');
            if (inMenu) return;
            closeMenus();
        };
        const onEsc = (event) => {
            if (event.key !== 'Escape') return;
            closeMenus();
            setDeleteTargetConv(null);
            setRenameTargetConv(null);
        };
        document.addEventListener('mousedown', onDocMouseDown);
        document.addEventListener('keydown', onEsc);
        return () => {
            document.removeEventListener('mousedown', onDocMouseDown);
            document.removeEventListener('keydown', onEsc);
        };
    }, []);

    async function ensureConversation(firstMessageTitle) {
        if (conversationId) return conversationId;

        setIsInitializing(true);
        try {
            const res = await aiApi.newChat(firstMessageTitle);
            const newId = res?.data?.conversation?.id;
            if (!newId) throw new Error('Could not create conversation');
            setConversationId(newId);
            setActiveConversationMeta(res?.data?.conversation ?? { id: newId, title: firstMessageTitle ?? 'New Conversation' });

            const ctx = buildContextMessage(drugId, drugData);
            if (ctx) {
                const ctxRes = await aiApi.sendMessage(newId, ctx);
                const assistantMessage = ctxRes?.data?.assistant_message;
                if (assistantMessage?.content) {
                    setDisplayMessages((prev) => [
                        ...prev,
                        toDisplayMessage(assistantMessage.content, assistantMessage.role, assistantMessage.sources),
                    ]);
                }
            }

            refreshConversations().catch(() => {});
            return newId;
        } finally {
            setIsInitializing(false);
        }
    }

    const sendUserMessage = async (rawText) => {
        const userText = rawText.trim();
        if (!userText || isTyping || isInitializing) return;

        const sourceDraftKey = activeDraftKey;
        const draftValue = rawText;
        clearComposer();

        setDisplayMessages((prev) => [...prev, { text: userText, sender: 'user' }]);
        setIsTyping(true);
        let targetConversationId = conversationId;
        let persistedDraftKey = sourceDraftKey;
        try {
            if (isTemporaryChat) {
                let nextTemporaryMessages = trimTemporaryMessages(temporaryConversationMessages);
                const contextMessage = buildContextMessage(drugId, drugData);

                if (nextTemporaryMessages.length === 0 && contextMessage) {
                    const contextSeedMessages = [{ role: 'user', content: contextMessage }];
                    const seedRes = await aiApi.sendTemporaryMessage(contextSeedMessages);
                    const seedAssistantMessage = seedRes?.data?.assistant_message;

                    if (seedAssistantMessage?.content) {
                        setDisplayMessages((prev) => [
                            ...prev,
                            toDisplayMessage(seedAssistantMessage.content, seedAssistantMessage.role, seedAssistantMessage.sources),
                        ]);
                    }

                    nextTemporaryMessages = appendTemporaryAssistantMessage(
                        contextSeedMessages,
                        seedAssistantMessage,
                    );
                    setTemporaryConversationMessages(nextTemporaryMessages);
                }

                const requestMessages = trimTemporaryMessages([
                    ...nextTemporaryMessages,
                    { role: 'user', content: userText },
                ]);
                const res = await aiApi.sendTemporaryMessage(requestMessages);
                const assistantMessage = res?.data?.assistant_message;
                const aiText = assistantMessage?.content ?? 'No response received.';

                setDisplayMessages((prev) => [
                    ...prev,
                    toDisplayMessage(aiText, assistantMessage?.role, assistantMessage?.sources),
                ]);
                setTemporaryConversationMessages(
                    appendTemporaryAssistantMessage(requestMessages, assistantMessage),
                );
                updateDraftValue(sourceDraftKey, '');
                return;
            }

            const convId = await ensureConversation(
                drugName ? `About ${drugName}` : userText.substring(0, 60),
            );
            targetConversationId = convId;
            persistedDraftKey = buildConversationDraftKey(convId) ?? sourceDraftKey;
            if (persistedDraftKey && sourceDraftKey && persistedDraftKey !== sourceDraftKey) {
                updateDraftValue(persistedDraftKey, draftValue);
                updateDraftValue(sourceDraftKey, '');
            }
            setTypingConversationIds((prev) =>
                prev.includes(convId) ? prev : [...prev, convId],
            );
            const res = await aiApi.sendMessage(convId, userText);
            const assistantMessage = res?.data?.assistant_message;
            const aiText = assistantMessage?.content ?? 'No response received.';
            setDisplayMessages((prev) => [
                ...prev,
                toDisplayMessage(aiText, assistantMessage?.role, assistantMessage?.sources),
            ]);
            updateDraftValue(persistedDraftKey, '');
            refreshConversations().catch(() => {});
            requestChatSearchRefresh();
        } catch (err) {
            setDisplayMessages((prev) => [
                ...prev,
                toDisplayMessage(`DoseGPT is unavailable right now. ${err.message}`, 'system'),
            ]);
            showToast('Failed to reach DoseGPT', 'error');
        } finally {
            if (targetConversationId) {
                setTypingConversationIds((prev) => prev.filter((id) => id !== targetConversationId));
            }
            setIsTyping(false);
        }
    };
    const handleSendMessage = async () => sendUserMessage(input);
    sendUserMessageRef.current = sendUserMessage;

    const isMobileSidebarViewport = () =>
        typeof window !== 'undefined' && window.matchMedia('(max-width: 760px)').matches;

    const closeMobileSidebar = () => {
        if (isMobileSidebarViewport()) setSidebarOpen(false);
    };

    const handleLoadConversation = async (conv) => {
        closeMenus();
        closeMobileSidebar();
        setIsLoadingConversation(true);
        try {
            const convId = conv?.id;
            const res = await aiApi.getMessages(convId, 1, 50);
            const msgs = res?.data?.messages ?? [];
            const visible = msgs.filter((m) => !m.content.startsWith('[SYSTEM CONTEXT'));
            setDisplayMessages(
                visible.map((m) => toDisplayMessage(m.content, m.role, m.sources)),
            );
            setTemporaryConversationMessages([]);
            setIsTemporaryChat(false);
            setConversationId(convId);
            setActiveConversationMeta(conv ?? null);
        } catch {
            showToast('Failed to load conversation', 'error');
        } finally {
            setIsLoadingConversation(false);
        }
    };

    const handleNewChat = () => {
        resetCurrentChat();
        closeMobileSidebar();
        restoreComposerFromDraft(
            isTemporaryChat ? temporaryConversationDraftKey : newConversationDraftKey,
            true,
        );
    };

    const handleOpenNewDraftConversation = () => {
        closeMenus();
        closeMobileSidebar();
        setIsTemporaryChat(false);
        setConversationId(null);
        setActiveConversationMeta(null);
        setDisplayMessages([]);
        setTemporaryConversationMessages([]);
        restoreComposerFromDraft(newConversationDraftKey, true);
    };

    const handleToggleTemporaryChat = () => {
        const nextTemporaryChatState = !isTemporaryChat;
        resetCurrentChat();
        setIsTemporaryChat(nextTemporaryChatState);
        showToast(
            nextTemporaryChatState
                ? 'Temporary chat is on. Messages in this chat will not be saved.'
                : 'Temporary chat is off. New chats will be saved again.',
        );
    };

    const handleSignOut = () => {
        setSidebarProfileOpen(false);
        logout();
        navigate('/', { replace: true });
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSendMessage();
        }
        if ((e.metaKey || e.ctrlKey) && e.key === 'n') {
            e.preventDefault();
            handleNewChat();
        }
    };

    const handleInputChange = (e) => {
        const nextValue = e.target.value;
        setInput(nextValue);
        updateDraftValue(activeDraftKey, nextValue);
        resizeComposer();
    };

    const toggleSidebarCollapsed = () => {
        setSidebarCollapsed((prev) => {
            const next = !prev;
            localStorage.setItem(sidebarStorageKey, next ? '1' : '0');
            return next;
        });
    };

    const handleSidebarControl = (e) => {
        e?.stopPropagation();
        if (isMobileSidebarViewport()) {
            closeMenus();
            setSidebarOpen((prev) => !prev);
            return;
        }
        toggleSidebarCollapsed();
    };

    const openMobileSidebar = (e) => {
        e?.stopPropagation();
        closeMenus();
        setSidebarOpen(true);
    };

    const openRenameConversation = (conv) => {
        setRenameTargetConv(conv);
        setRenameValue(conv?.title ?? '');
        closeMenus();
    };

    const confirmRenameConversation = async () => {
        if (!renameTargetConv?.id) return;
        const cleanTitle = renameValue.trim();
        if (!cleanTitle) {
            showToast('Chat title cannot be empty', 'error');
            return;
        }
        try {
            await aiApi.updateTitle(renameTargetConv.id, cleanTitle);
            setConversations((prev) =>
                prev.map((item) => (item.id === renameTargetConv.id ? { ...item, title: cleanTitle } : item)),
            );
            setChatSearchResults((prev) =>
                prev.map((item) => (item.id === renameTargetConv.id ? { ...item, title: cleanTitle } : item)),
            );
            if (conversationId === renameTargetConv.id) {
                setActiveConversationMeta((prev) => (prev ? { ...prev, title: cleanTitle } : prev));
            }
            setRenameTargetConv(null);
            setRenameValue('');
            requestChatSearchRefresh();
        } catch {
            showToast('Failed to rename chat', 'error');
        }
    };

    const requestDeleteConversation = (conv) => {
        setDeleteTargetConv(conv);
        closeMenus();
    };

    const confirmDeleteConversation = async () => {
        if (!deleteTargetConv?.id) return;
        try {
            await aiApi.deleteConversation(deleteTargetConv.id);
            setConversations((prev) => prev.filter((item) => item.id !== deleteTargetConv.id));
            setChatSearchResults((prev) => prev.filter((item) => item.id !== deleteTargetConv.id));
            persistPinnedIds(pinnedConversationIds.filter((id) => id !== deleteTargetConv.id));
            updateDraftValue(buildConversationDraftKey(deleteTargetConv.id), '');
            if (conversationId === deleteTargetConv.id) handleNewChat();
            setDeleteTargetConv(null);
            requestChatSearchRefresh();
        } catch {
            showToast('Failed to delete chat', 'error');
        }
    };

    const copyTextToClipboard = async (text) => {
        if (navigator.clipboard?.writeText) {
            try {
                await navigator.clipboard.writeText(text);
                return true;
            } catch {
                // Fall back to a temporary selection for browsers that expose
                // clipboard APIs but deny writes in the current context.
            }
        }

        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.setAttribute('readonly', '');
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        textarea.setSelectionRange(0, text.length);

        try {
            const copied = document.execCommand('copy');
            if (!copied) throw new Error('Copy command failed');
            return true;
        } catch {
            return false;
        } finally {
            document.body.removeChild(textarea);
        }
    };

    const handleShareConversation = async (conv) => {
        if (!conv?.id || sharingConversationIds.includes(conv.id)) return;
        setSharingConversationIds((prev) => (
            prev.includes(conv.id) ? prev : [...prev, conv.id]
        ));
        try {
            const res = await aiApi.shareConversation(conv.id);
            const sharePath = res?.data?.share?.urlPath;
            if (!sharePath) throw new Error('Share link was not returned');

            const shareUrl = new URL(sharePath, window.location.origin).toString();
            const copied = await copyTextToClipboard(shareUrl);
            if (copied) {
                showToast('Share link copied to clipboard');
            } else {
                setShareFallbackUrl(shareUrl);
                showToast('Share link created. Copy it from the dialog.', 'info');
            }
        } catch (error) {
            showToast(error?.message || 'Failed to create share link', 'error');
        } finally {
            setSharingConversationIds((prev) => prev.filter((id) => id !== conv.id));
            closeMenus();
        }
    };

    const openTopbarMenuForCurrent = () => {
        if (!currentConversation) return;
        setTopbarMenuOpen((prev) => !prev);
        setOpenConversationMenuId(null);
    };

    const handleCopyFallbackShareLink = async () => {
        if (!shareFallbackUrl) return;
        const copied = await copyTextToClipboard(shareFallbackUrl);
        showToast(copied ? 'Share link copied to clipboard' : 'Could not copy link automatically', copied ? 'success' : 'error');
        if (copied) setShareFallbackUrl('');
    };

    const handleCopyMessage = async (text, idx) => {
        const copied = await copyTextToClipboard(text);
        if (!copied) {
            showToast('Could not copy message', 'error');
            return;
        }
        setCopiedMessageIdx(idx);
        if (copyMessageResetRef.current) window.clearTimeout(copyMessageResetRef.current);
        copyMessageResetRef.current = window.setTimeout(() => setCopiedMessageIdx(null), 1600);
    };

    useEffect(() => () => {
        if (copyMessageResetRef.current) window.clearTimeout(copyMessageResetRef.current);
    }, []);

    useEffect(() => {
        if (hasAutoSentPromptRef.current) return;
        if (!initialPrompt?.trim()) return;
        if (displayMessages.length > 0 || isTyping || isInitializing) return;
        if (initialPromptConsumeKey && sessionStorage.getItem(initialPromptConsumeKey) === '1') {
            hasAutoSentPromptRef.current = true;
            return;
        }
        hasAutoSentPromptRef.current = true;
        if (initialPromptConsumeKey) {
            sessionStorage.setItem(initialPromptConsumeKey, '1');
        }
        sendUserMessageRef.current?.(initialPrompt);
    }, [initialPrompt, displayMessages.length, isTyping, isInitializing, initialPromptConsumeKey]);

    const drugChips = drugName
        ? [
              `What are the indications for ${drugName}?`,
              `Side effects of ${drugName}?`,
              `Dosage guidelines for ${drugName}`,
              `Drug interactions with ${drugName}?`,
          ]
        : [];
    const handleChip = (text) => {
        setInput(text);
        updateDraftValue(activeDraftKey, text);
        window.requestAnimationFrame(() => {
            resizeComposer();
        });
        setTimeout(() => inputRef.current?.focus(), 50);
    };

    const renderConversationRow = (conv, options = {}) => {
        const {
            draftKey = buildConversationDraftKey(conv?.id),
            isDraftConversation = false,
            onSelect,
        } = options;
        const isPinnedConversation = !isDraftConversation && pinnedIdSet.has(conv.id);
        const isSharingConversation = !isDraftConversation && sharingConversationIds.includes(conv.id);
        const draftPreview = getDraftPreviewText(draftKey ? conversationDrafts[draftKey] : '');
        const previewText = conv?.matched_message_preview?.trim();
        const rowPreview = draftPreview || (isChatSearchActive ? previewText : '');
        const hasPreview = Boolean(rowPreview);
        const isSearchResultRow = hasPreview;
        const isActiveConversation = isDraftConversation
            ? !conversationId && !isTemporaryChat
            : conv.id === conversationId;
        const timestampText = isDraftConversation
            ? 'Just now'
            : formatConversationTimestamp(conv?.updated_at ?? conv?.created_at);

        return (
            <div
                key={conv.id}
                className={`cb-history-row ${isActiveConversation ? 'active' : ''} ${isSearchResultRow ? 'search-result' : ''}`}
            >
                <button
                    type="button"
                    className={`cb-history-item ${isActiveConversation ? 'active' : ''}`}
                    onClick={onSelect ?? (() => handleLoadConversation(conv))}
                >
                    {isPinnedConversation && (
                        <span className="cb-history-pin-dot" aria-hidden="true">
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                                <path d="M15 3a1 1 0 0 1 .8.4l1.8 2.4a1 1 0 0 1-.08 1.3l-2.02 2.02 2.58 4.51a1 1 0 0 1-.87 1.5H13v4.83a1 1 0 0 1-1.7.71l-1.6-1.6a1 1 0 0 1-.3-.7v-3.24H6.17a1 1 0 0 1-.7-1.7l4.95-4.95-2.01-2a1 1 0 0 1-.09-1.31l1.8-2.4A1 1 0 0 1 10.93 3z" />
                            </svg>
                        </span>
                    )}
                    <span className="cb-history-item-copy">
                        <span className="cb-history-item-main">
                            <span className="cb-history-item-text">{conv.title}</span>
                            {timestampText && <span className="cb-history-item-time">{timestampText}</span>}
                        </span>
                        {hasPreview && (
                            <span className={`cb-history-item-preview ${draftPreview ? 'draft' : ''}`}>
                                <span className="cb-history-item-preview-text">{rowPreview}</span>
                            </span>
                        )}
                    </span>
                </button>
                {!isDraftConversation && (
                    <div className="cb-history-more-wrap">
                        <button
                            type="button"
                            className="cb-history-more-btn"
                            aria-expanded={openConversationMenuId === conv.id}
                            aria-label={`More actions for ${conv.title}`}
                            onClick={(e) => {
                                e.stopPropagation();
                                setTopbarMenuOpen(false);
                                setOpenConversationMenuId((prev) => (prev === conv.id ? null : conv.id));
                            }}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                <circle cx="5" cy="12" r="1" />
                                <circle cx="12" cy="12" r="1" />
                                <circle cx="19" cy="12" r="1" />
                            </svg>
                        </button>
                        {openConversationMenuId === conv.id && (
                            <div className="cb-chat-more-menu" onClick={(e) => e.stopPropagation()}>
                                <button type="button" className="cb-chat-more-item" onClick={() => openRenameConversation(conv)}>Rename chat</button>
                                <button type="button" className="cb-chat-more-item" onClick={() => handleShareConversation(conv)} disabled={isSharingConversation}>
                                    {isSharingConversation ? 'Creating link...' : 'Share'}
                                </button>
                                <button type="button" className="cb-chat-more-item" onClick={() => togglePinConversation(conv.id)}>{isPinnedConversation ? 'Unpin chat' : 'Pin chat'}</button>
                                <button type="button" className="cb-chat-more-item danger" onClick={() => requestDeleteConversation(conv)}>Delete</button>
                            </div>
                        )}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="chatbot-page" onClick={() => { setSidebarProfileOpen(false); }}>
            <div className="chatbot-body">
            <aside id="dosegpt-sidebar" className={`chatbot-sidebar ${sidebarOpen ? 'open' : ''} ${sidebarCollapsed ? 'collapsed' : ''}`}>
                <div className="chatbot-sidebar-top">
                    <Link to="/" className="cb-sidebar-wordmark" aria-label="DoseFinder home">
                        <span className="cb-sidebar-wordmark-dose">Dose</span>
                        <span className="cb-sidebar-wordmark-finder">Finder</span>
                    </Link>
                    <div className="cb-sidebar-toggle-slot">
                        <button type="button" className="cb-icon-btn cb-sidebar-collapse-btn" onClick={handleSidebarControl} aria-label="Toggle sidebar" aria-controls="dosegpt-sidebar">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round">
                                <rect x="2" y="3" width="20" height="18" rx="2.5" />
                                <line x1="10" y1="3" x2="10" y2="21" />
                            </svg>
                        </button>
                        <button type="button" className="cb-sidebar-collapse-expand-btn" onClick={handleSidebarControl} aria-label="Expand sidebar" aria-controls="dosegpt-sidebar">
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m9 18 6-6-6-6" />
                            </svg>
                        </button>
                    </div>
                </div>
                <div className="cb-sidebar-divider" />

                <div className="cb-assistant-header">
                    <span className="cb-assistant-icon" aria-hidden="true">
                        <Logo size={14} color="#fff" />
                    </span>
                    <span className="cb-assistant-copy">
                        <span className="cb-assistant-title">DoseGPT</span>
                        <span className="cb-assistant-subtitle">v1 · DoseFinder</span>
                    </span>
                </div>

                <button className="cb-new-chat-btn" type="button" onClick={handleNewChat}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                        <line x1="12" y1="5" x2="12" y2="19" />
                        <line x1="5" y1="12" x2="19" y2="12" />
                    </svg>
                    <span className="cb-new-chat-label">New Chat</span>
                    {!sidebarCollapsed && <span className="cb-shortcut">Ctrl+N</span>}
                </button>
                {sidebarCollapsed ? (
                    <button className="cb-search-chat-btn" type="button" onClick={focusChatSearch}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                    </button>
                ) : (
                    <label className="cb-search-chat-box">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                            <circle cx="11" cy="11" r="8" />
                            <path d="m21 21-4.35-4.35" />
                        </svg>
                        <input
                            ref={searchInputRef}
                            type="search"
                            className="cb-search-chat-input"
                            placeholder="Search chats"
                            value={chatSearchQuery}
                            onChange={(e) => setChatSearchQuery(e.target.value)}
                        />
                        {isChatSearchActive && (
                            <button type="button" className="cb-search-chat-clear" onClick={clearChatSearch} aria-label="Clear chat search">
                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                    <path d="M18 6 6 18" />
                                    <path d="m6 6 12 12" />
                                </svg>
                            </button>
                        )}
                    </label>
                )}

                {!sidebarCollapsed && isTemporaryChat && (
                    <div className="cb-history-empty cb-history-note">
                        Temporary chat is on. This thread stays out of saved history until you switch back.
                    </div>
                )}

                <div className="cb-history-area">
                    {!sidebarCollapsed && isChatSearchActive && (
                        <div className="cb-history-group">
                            <div className="cb-history-heading">
                                <p className="cb-history-label">SEARCH RESULTS</p>
                                <span className="cb-history-count">{isSearchingChats ? '...' : chatSearchResults.length}</span>
                            </div>
                            {isSearchingChats ? (
                                <div className="cb-history-empty">Searching chats...</div>
                            ) : chatSearchResults.length > 0 ? (
                                <div className="cb-history-items">
                                    {chatSearchResults.map((conv) => renderConversationRow(conv))}
                                </div>
                            ) : (
                                <div className="cb-history-empty">No chats found for "{normalizedChatSearchQuery}"</div>
                            )}
                        </div>
                    )}

                    {!sidebarCollapsed && !isChatSearchActive && pinnedConversations.length > 0 && (
                        <div className="cb-history-group cb-history-group-pinned">
                            <div className="cb-history-heading">
                                <p className="cb-history-label">PINNED</p>
                            </div>
                            <div className="cb-history-items cb-history-items-pinned">
                                {pinnedConversations.map((conv) => renderConversationRow(conv))}
                            </div>
                        </div>
                    )}

                    {!sidebarCollapsed && !isChatSearchActive && (showNewConversationDraftRow || recentConversations.length > 0) && (
                        <div className="cb-history-group">
                            <div className="cb-history-heading">
                                <p className="cb-history-label">RECENT</p>
                            </div>
                            <div className="cb-history-items">
                                {showNewConversationDraftRow && renderConversationRow(
                                    {
                                        id: `draft:${newConversationDraftKey}`,
                                        title: drugName ? `New chat about ${drugName}` : 'New chat',
                                    },
                                    {
                                        draftKey: newConversationDraftKey,
                                        isDraftConversation: true,
                                        onSelect: handleOpenNewDraftConversation,
                                    },
                                )}
                                {recentConversations.map((conv) => renderConversationRow(conv))}
                            </div>
                        </div>
                    )}

                    {!sidebarCollapsed && !isChatSearchActive && conversations.length === 0 && !showNewConversationDraftRow && (
                        <div className="cb-history-empty">Your chats will appear here.</div>
                    )}
                </div>

                {isGuestUser ? (
                    <div className="cb-sidebar-profile cb-sidebar-login" onClick={(e) => e.stopPropagation()}>
                        <Link
                            to="/login"
                            className="cb-sidebar-login-link"
                            onClick={() => {
                                closeMenus();
                                closeMobileSidebar();
                            }}
                        >
                            <span className="cb-sidebar-login-icon" aria-hidden="true">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4" />
                                    <polyline points="10 17 15 12 10 7" />
                                    <line x1="15" y1="12" x2="3" y2="12" />
                                </svg>
                            </span>
                            <span className="cb-sidebar-login-copy">
                                <span className="cb-sidebar-login-title">Login</span>
                                <span className="cb-sidebar-login-subtitle">Save chats and settings</span>
                            </span>
                        </Link>
                    </div>
                ) : (
                    <div className="cb-sidebar-profile" onClick={(e) => e.stopPropagation()}>
                        <button
                            type="button"
                            className={`cb-sidebar-profile-trigger ${sidebarProfileOpen ? 'active' : ''}`}
                            onClick={() => setSidebarProfileOpen((prev) => !prev)}
                            aria-expanded={sidebarProfileOpen}
                            aria-label="Account menu"
                        >
                            <span className="cb-sidebar-profile-avatar">{userInitials}</span>
                            <span className="cb-sidebar-profile-copy">
                                <span className="cb-sidebar-profile-name">{userDisplayName}</span>
                                <span className="cb-sidebar-profile-role">{userProfileMeta}</span>
                            </span>
                            <svg className="cb-sidebar-profile-chevron" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="m6 9 6 6 6-6" />
                            </svg>
                        </button>
                        {sidebarProfileOpen && (
                            <div className="cb-sidebar-profile-menu" onClick={(e) => e.stopPropagation()}>
                                <Link to="/settings" className="cb-sidebar-profile-item" onClick={() => setSidebarProfileOpen(false)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
                                        <circle cx="12" cy="7" r="4" />
                                    </svg>
                                    <span>Profile</span>
                                </Link>
                                <Link to="/saved" className="cb-sidebar-profile-item" onClick={() => setSidebarProfileOpen(false)}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                                    </svg>
                                    <span>My Saved</span>
                                </Link>
                                <div className="cb-sidebar-profile-divider" />
                                <button type="button" className="cb-sidebar-profile-item cb-sidebar-profile-item--danger" onClick={handleSignOut}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                        <polyline points="16 17 21 12 16 7" />
                                        <line x1="21" y1="12" x2="9" y2="12" />
                                    </svg>
                                    <span>Sign Out</span>
                                </button>
                            </div>
                        )}
                    </div>
                )}

            </aside>

            <main className="cb-main-panel">
                <div className="cb-topbar">
                    <div className="cb-topbar-left">
                        <div className="cb-mobile-brand">
                            <button
                                type="button"
                                className="cb-mobile-menu-btn"
                                onClick={openMobileSidebar}
                                aria-label="Open sidebar"
                                aria-expanded={sidebarOpen}
                                aria-controls="dosegpt-sidebar"
                            >
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="3" y1="12" x2="21" y2="12" /><line x1="3" y1="6" x2="21" y2="6" /><line x1="3" y1="18" x2="21" y2="18" /></svg>
                            </button>
                            <Link to="/" className="cb-mobile-wordmark" aria-label="DoseFinder home">
                                <span className="cb-mobile-wordmark-dose">Dose</span>
                                <span className="cb-mobile-wordmark-finder">Finder</span>
                            </Link>
                        </div>
                        <span className="cb-model-selector cb-model-selector--static">DoseGPT v1</span>
                    </div>

                    <div className="cb-topbar-right">
                        <button
                            type="button"
                            className={`cb-temp-chat-toggle ${isTemporaryChat ? 'active' : ''}`}
                            onClick={handleToggleTemporaryChat}
                            aria-pressed={isTemporaryChat}
                            aria-label={isTemporaryChat ? 'Turn off temporary chat' : 'Start temporary chat'}
                            title={isTemporaryChat ? 'Temporary chat is on' : 'Temporary chat'}
                        >
                            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M8 11V7a4 4 0 1 1 8 0v4" />
                                <rect x="5" y="11" width="14" height="10" rx="2" />
                                <path d="M12 15v2" />
                            </svg>
                        </button>
                        {isTemporaryChat && (
                            <span className="cb-topbar-badge cb-topbar-badge-temporary">Temporary chat</span>
                        )}
                        {canManageCurrentConversation && (
                            <div className="cb-topbar-menu-wrap">
                                <button className="cb-icon-btn" onClick={openTopbarMenuForCurrent} aria-label="More chat actions">
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                                        <circle cx="5" cy="12" r="1" /><circle cx="12" cy="12" r="1" /><circle cx="19" cy="12" r="1" />
                                    </svg>
                                </button>
                                {topbarMenuOpen && currentConversation && (
                                    <div className="cb-chat-more-menu cb-chat-more-menu-top" onClick={(e) => e.stopPropagation()}>
                                        <button type="button" className="cb-chat-more-item" onClick={() => openRenameConversation(currentConversation)}>Rename chat</button>
                                        <button type="button" className="cb-chat-more-item" onClick={() => handleShareConversation(currentConversation)} disabled={isSharingCurrentConversation}>
                                            {isSharingCurrentConversation ? 'Creating link...' : 'Share'}
                                        </button>
                                        <button type="button" className="cb-chat-more-item" onClick={() => togglePinConversation(currentConversation.id)}>{currentPinned ? 'Unpin chat' : 'Pin chat'}</button>
                                        <button type="button" className="cb-chat-more-item danger" onClick={() => requestDeleteConversation(currentConversation)}>Delete</button>
                                    </div>
                                )}
                            </div>
                        )}
                        {canManageCurrentConversation && (
                            <button className="cb-share-btn" onClick={() => handleShareConversation(currentConversation)} disabled={isSharingCurrentConversation}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" /></svg>
                                {isSharingCurrentConversation ? 'Sharing...' : 'Share'}
                            </button>
                        )}
                    </div>
                </div>

                <div className="cb-chat-area" ref={chatAreaRef}>
                    {displayMessages.length === 0 ? (
                        <div className="cb-welcome-screen">
                            <div className="cb-welcome-logo"><Logo size={72} /></div>
                            <h1 className="cb-welcome-title">{drugName ? `Ask me anything about ${drugName}` : "Let's start a smart conversation"}</h1>
                            {isTemporaryChat && (
                                <p className="cb-welcome-note">This conversation will not be saved to your chat history.</p>
                            )}
                            {drugChips.length > 0 && (
                                <div className="cb-chip-grid">
                                    {drugChips.map((chip) => (
                                        <button key={chip} className="cb-chip" onClick={() => handleChip(chip)}>{chip}</button>
                                    ))}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="cb-messages-list">
                            {displayMessages.map((msg, idx) => (
                                msg.sender === 'system' ? (
                                    <div key={idx} className="cb-msg-row system">
                                        <div className="cb-system-card" role="status" aria-live="polite">
                                            <div className="cb-system-card-label">
                                                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                                                    <circle cx="12" cy="12" r="9" />
                                                    <path d="M12 8h.01" />
                                                    <path d="M11 12h1v4h1" />
                                                </svg>
                                                System notice
                                            </div>
                                            <div className="cb-msg-bubble cb-system-bubble">{renderMarkdown(msg.text)}</div>
                                        </div>
                                    </div>
                                ) : (
                                    <div key={idx} className={`cb-msg-row ${msg.sender}`}>
                                        {msg.sender === 'ai' && <div className="cb-msg-avatar cb-ai-avatar"><Logo size={14} color="#fff" /></div>}
                                        <div className="cb-msg-stack">
                                            <div className={`cb-msg-bubble ${msg.sender === 'user' ? 'cb-user-bubble' : 'cb-ai-bubble'}`}>
                                                {msg.sender === 'user' ? msg.text : (
                                                    <>
                                                        {renderMarkdown(msg.text)}
                                                        <MessageSources sources={msg.sources} />
                                                    </>
                                                )}
                                            </div>
                                            <div className="cb-msg-actions">
                                                <button
                                                    type="button"
                                                    className={`cb-msg-copy-btn ${copiedMessageIdx === idx ? 'copied' : ''}`}
                                                    onClick={() => handleCopyMessage(msg.text, idx)}
                                                    aria-label={copiedMessageIdx === idx ? 'Message copied' : 'Copy message'}
                                                    title={copiedMessageIdx === idx ? 'Copied' : 'Copy message'}
                                                >
                                                    {copiedMessageIdx === idx ? (
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                                            <polyline points="20 6 9 17 4 12" />
                                                        </svg>
                                                    ) : (
                                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                            <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                                                            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                                                        </svg>
                                                    )}
                                                </button>
                                            </div>
                                        </div>
                                        {msg.sender === 'user' && <div className="cb-msg-avatar cb-user-msg-avatar">A</div>}
                                    </div>
                                )
                            ))}
                            {showTypingIndicator && (
                                <div className="cb-msg-row ai">
                                    <div className="cb-msg-avatar cb-ai-avatar"><Logo size={14} color="#fff" /></div>
                                    <div className="cb-msg-bubble cb-ai-bubble">
                                        <div className="cb-typing-dots"><span /><span /><span /></div>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                <div className="cb-input-area-wrap">
                    <div className="cb-input-box">
                        <textarea
                            ref={inputRef}
                            className="cb-chat-input"
                            placeholder={drugName ? `Ask about ${drugName}.` : 'Ask me anything.'}
                            rows="1"
                            value={input}
                            onChange={handleInputChange}
                            onKeyDown={handleKeyDown}
                            disabled={isTyping || isInitializing || isLoadingConversation}
                        />
                        <div className="cb-input-toolbar">
                            <div className="cb-toolbar-left">
                                <button
                                    type="button"
                                    className="cb-feature-btn cb-feature-btn-coming-soon"
                                    disabled
                                    title="Deeper Research is coming soon"
                                >
                                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" /></svg>
                                    Deeper Research
                                    <span className="cb-coming-soon-badge">Soon</span>
                                </button>
                            </div>
                            <div className="cb-toolbar-right">
                                <button type="button" className="cb-icon-btn-sm" onClick={() => showToast('File attachment coming soon')}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.2-9.19a4 4 0 0 1 5.66 5.65l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" /></svg>
                                </button>
                                <button type="button" className="cb-send-btn" onClick={handleSendMessage} disabled={isTyping || isInitializing || isLoadingConversation}>
                                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                    <p className="cb-disclaimer-text">
                        Responses are limited to DoseFinder data and can still miss information. Double check important info.
                        <button type="button" className="cb-disclaimer-link" onClick={() => showToast('Terms & Conditions page is coming soon.')}>
                            Terms &amp; Conditions.
                        </button>
                    </p>
                </div>
            </main>

            {deleteTargetConv && (
                <div className="cb-modal-overlay" onClick={() => setDeleteTargetConv(null)}>
                    <div className="cb-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Delete chat?</h3>
                        <p>This action cannot be undone.</p>
                        <div className="cb-modal-actions">
                            <button type="button" className="cb-modal-btn" onClick={() => setDeleteTargetConv(null)}>Cancel</button>
                            <button type="button" className="cb-modal-btn danger" onClick={confirmDeleteConversation}>Delete</button>
                        </div>
                    </div>
                </div>
            )}

            {renameTargetConv && (
                <div className="cb-modal-overlay" onClick={() => setRenameTargetConv(null)}>
                    <div className="cb-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Rename chat</h3>
                        <p>Enter a new title for this conversation.</p>
                        <input
                            type="text"
                            className="cb-modal-input"
                            value={renameValue}
                            onChange={(e) => setRenameValue(e.target.value)}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter') confirmRenameConversation();
                            }}
                            autoFocus
                        />
                        <div className="cb-modal-actions">
                            <button type="button" className="cb-modal-btn" onClick={() => setRenameTargetConv(null)}>Cancel</button>
                            <button type="button" className="cb-modal-btn primary" onClick={confirmRenameConversation}>Save</button>
                        </div>
                    </div>
                </div>
            )}
            {shareFallbackUrl && (
                <div className="cb-modal-overlay" onClick={() => setShareFallbackUrl('')}>
                    <div className="cb-modal" onClick={(e) => e.stopPropagation()}>
                        <h3>Share link ready</h3>
                        <p>Copy this link to share a read-only snapshot of the chat.</p>
                        <input
                            type="text"
                            className="cb-modal-input"
                            value={shareFallbackUrl}
                            readOnly
                            onFocus={(e) => e.target.select()}
                            autoFocus
                        />
                        <div className="cb-modal-actions">
                            <button type="button" className="cb-modal-btn" onClick={() => setShareFallbackUrl('')}>Close</button>
                            <button type="button" className="cb-modal-btn primary" onClick={handleCopyFallbackShareLink}>Copy link</button>
                        </div>
                    </div>
                </div>
            )}
            </div>
        </div>
    );
}

