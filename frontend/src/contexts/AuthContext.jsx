import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { authApi, getToken, setToken, registerEnsureToken } from '../services/api';

const AuthContext = createContext(null);
const PENDING_VERIFICATION_KEY = 'dms_pending_verification';
const GUEST_SESSION_KEY = 'dms_guest_session';
let guestCreationPromise = null;

function getStoredPendingVerification() {
    const rawValue = localStorage.getItem(PENDING_VERIFICATION_KEY);
    if (!rawValue) return null;

    try {
        const parsed = JSON.parse(rawValue);
        return parsed?.email ? parsed : null;
    } catch {
        localStorage.removeItem(PENDING_VERIFICATION_KEY);
        return null;
    }
}

function persistPendingVerification(payload) {
    if (payload?.email) {
        localStorage.setItem(PENDING_VERIFICATION_KEY, JSON.stringify(payload));
        return payload;
    }

    localStorage.removeItem(PENDING_VERIFICATION_KEY);
    return null;
}

function getStoredGuestSession() {
    const rawValue = localStorage.getItem(GUEST_SESSION_KEY);
    if (!rawValue) return null;

    try {
        const parsed = JSON.parse(rawValue);
        if (parsed?.guestUsername && parsed?.guestAuthToken) return parsed;
    } catch {
        // Ignore malformed storage and clear it below.
    }

    localStorage.removeItem(GUEST_SESSION_KEY);
    return null;
}

function persistGuestSession(payload) {
    if (payload?.guestUsername && payload?.guestAuthToken) {
        localStorage.setItem(GUEST_SESSION_KEY, JSON.stringify(payload));
        return payload;
    }

    localStorage.removeItem(GUEST_SESSION_KEY);
    return null;
}

function requestGuestSession({ forceNew = false } = {}) {
    if (forceNew) {
        guestCreationPromise = null;
    }

    if (!guestCreationPromise) {
        const nextGuestCreationPromise = authApi
            .createGuest()
            .then((res) => res.data ?? {})
            .finally(() => {
                if (guestCreationPromise === nextGuestCreationPromise) {
                    guestCreationPromise = null;
                }
            });

        guestCreationPromise = nextGuestCreationPromise;
    }

    return guestCreationPromise;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(null);
    const [pendingVerification, setPendingVerification] = useState(() => getStoredPendingVerification());
    const [guestSession, setGuestSession] = useState(() => getStoredGuestSession());
    const [loading, setLoading] = useState(true);
    const [refreshingSession, setRefreshingSession] = useState(false);
    const [isLoggingOut, setIsLoggingOut] = useState(false);
    const guestSessionRequestId = useRef(0);

    const syncAuthenticatedUser = useCallback((nextUser) => {
        setUser(nextUser);

        if (nextUser?.role !== 'guest') {
            guestSessionRequestId.current += 1;
            // Only clear React state — intentionally keep dms_guest_session in
            // localStorage so the guest token can be restored after logout.
            setGuestSession(null);
        }

        if (nextUser?.role !== 'guest' && nextUser && !nextUser.emailVerified) {
            setPendingVerification(persistPendingVerification({
                email: nextUser.email,
                username: nextUser.username
            }));
            return nextUser;
        }

        setPendingVerification(persistPendingVerification(null));
        return nextUser;
    }, []);

    const createGuestSession = useCallback(async (options = {}) => {
        const requestId = guestSessionRequestId.current + 1;
        guestSessionRequestId.current = requestId;

        const authData = await requestGuestSession(options);
        if (guestSessionRequestId.current !== requestId) {
            return authData;
        }

        const nextUser = authData.user ?? null;

        if (authData.token) {
            setToken(authData.token);
        }

        setUser(nextUser);
        setPendingVerification(persistPendingVerification(null));
        setGuestSession(persistGuestSession({
            guestUsername: authData.guestUsername,
            guestAuthToken: authData.guestAuthToken,
            guestToken: authData.token ?? null,
        }));

        return authData;
    }, []);

    // Try to restore the saved guest session; falls back to creating a new one.
    const restoreOrCreateGuestSession = useCallback(async () => {
        const stored = getStoredGuestSession();
        if (stored?.guestToken) {
            setToken(stored.guestToken);
            try {
                const res = await authApi.getMe();
                const nextUser = res.data?.user ?? null;
                if (nextUser?.role === 'guest') {
                    setUser(nextUser);
                    setPendingVerification(persistPendingVerification(null));
                    setGuestSession(stored);
                    return stored;
                }
            } catch {
                // Token expired or invalid — fall through to create a fresh guest.
            }
            setToken(null);
        }
        return createGuestSession();
    }, [createGuestSession]);

    const refreshSession = useCallback(async () => {
        const token = getToken();
        if (!token) {
            setUser(null);
            setPendingVerification(persistPendingVerification(null));
            setGuestSession(null);
            await restoreOrCreateGuestSession();
            return null;
        }

        setRefreshingSession(true);
        try {
            const res = await authApi.getMe();
            const nextUser = res.data?.user ?? null;
            return syncAuthenticatedUser(nextUser);
        } catch (error) {
            setToken(null);
            setUser(null);
            setPendingVerification(persistPendingVerification(null));
            setGuestSession(null);
            await restoreOrCreateGuestSession();
            return null;
        } finally {
            setRefreshingSession(false);
        }
    }, [restoreOrCreateGuestSession, syncAuthenticatedUser]);

    // Hydrate session on mount
    useEffect(() => {
        const token = getToken();
        if (!token) {
            restoreOrCreateGuestSession()
                .catch(() => {
                    setToken(null);
                    setUser(null);
                    setGuestSession(null);
                })
                .finally(() => setLoading(false));
            return undefined;
        }
        authApi
            .getMe()
            .then((res) => {
                const nextUser = res.data?.user ?? null;
                syncAuthenticatedUser(nextUser);
            })
            .catch(() => {
                setToken(null); // invalid / expired token
                setUser(null);
                setPendingVerification(persistPendingVerification(null));
                setGuestSession(null);
                return restoreOrCreateGuestSession();
            })
            .finally(() => setLoading(false));
    }, [restoreOrCreateGuestSession, syncAuthenticatedUser]);

    // Register a callback so api.js can auto-create a guest when no token exists,
    // preventing "No token provided" errors on race conditions during startup.
    useEffect(() => {
        registerEnsureToken(async () => {
            await restoreOrCreateGuestSession();
            return getToken();
        });
    }, [restoreOrCreateGuestSession]);

    const login = useCallback(async (credentials) => {
        const res = await authApi.login(credentials);
        const authData = res.data;
        const { token, user: userData } = authData;
        setToken(token);
        syncAuthenticatedUser(userData);
        return authData;
    }, [syncAuthenticatedUser]);

    const signup = useCallback(async (userData) => {
        let activeGuestSession = guestSession;

        if (user?.role !== 'guest' || !activeGuestSession?.guestUsername || !activeGuestSession?.guestAuthToken) {
            const createdGuest = await createGuestSession();
            activeGuestSession = {
                guestUsername: createdGuest.guestUsername,
                guestAuthToken: createdGuest.guestAuthToken,
            };
        }

        const res = await authApi.registerGuest({
            guestUsername: activeGuestSession.guestUsername,
            guestAuthToken: activeGuestSession.guestAuthToken,
            ...userData,
        });
        const authData = res.data;
        if (authData?.token) {
            setToken(authData.token);
        }
        if (authData?.user) {
            syncAuthenticatedUser({
                ...authData.user,
                emailVerified: false,
            });
            // The guest account was consumed (upgraded) during registration — clear
            // it from localStorage so logout creates a fresh guest rather than
            // trying to restore a guest that no longer exists.
            persistGuestSession(null);
        }
        return authData;
    }, [createGuestSession, guestSession, syncAuthenticatedUser, user?.role]);

    const googleSignIn = useCallback(async (credential) => {
        // Pass the current guest's credentials so the backend can upgrade that guest
        // row in place (preserving saved drugs / history) when this is a new account.
        const activeGuestSession = user?.role === 'guest' ? guestSession : null;
        const res = await authApi.googleAuth({
            credential,
            guestUsername: activeGuestSession?.guestUsername,
            guestAuthToken: activeGuestSession?.guestAuthToken,
        });
        const authData = res.data;
        if (authData?.token) {
            setToken(authData.token);
        }
        if (authData?.user) {
            syncAuthenticatedUser(authData.user);
            if (authData.isNewUser) {
                // A new account may have consumed the guest row — clear it so logout
                // creates a fresh guest instead of restoring a defunct one.
                persistGuestSession(null);
            }
        }
        return authData;
    }, [guestSession, syncAuthenticatedUser, user?.role]);

    const verifyEmail = useCallback(async ({ email, otp }) => {
        const res = await authApi.verifyEmail({ email, otp });
        const nextUser = res.data?.user ?? null;

        if (getToken()) {
            setUser((currentUser) => {
                if (nextUser) {
                    return {
                        ...currentUser,
                        ...nextUser,
                        emailVerified: true,
                    };
                }

                if (!currentUser) {
                    return currentUser;
                }

                return {
                    ...currentUser,
                    emailVerified: true,
                };
            });
        }

        setPendingVerification(persistPendingVerification(null));
        return res;
    }, []);

    const resendVerificationEmail = useCallback(async (email) => {
        return authApi.resendVerification(email);
    }, []);

    const logout = useCallback(() => {
        setIsLoggingOut(true);
        const revokeSession = getToken()
            ? authApi.logout().catch(() => null)
            : Promise.resolve(null);

        setToken(null);
        setUser(null);
        setPendingVerification(persistPendingVerification(null));
        // Intentionally do NOT clear dms_guest_session here — restoreOrCreateGuestSession
        // will reuse it if the guest token is still valid.
        if (typeof window !== 'undefined') {
            window.dispatchEvent(new Event('dms:logout'));
        }
        const guestSessionRefresh = restoreOrCreateGuestSession()
            .catch(() => {
                setToken(null);
                setUser(null);
                return null;
            });
        const nextGuestSession = Promise.allSettled([revokeSession, guestSessionRefresh])
            .then((results) => {
                const guestResult = results[1];
                return guestResult.status === 'fulfilled' ? guestResult.value : null;
            })
            .finally(() => {
                setIsLoggingOut(false);
            });

        return nextGuestSession;
    }, [restoreOrCreateGuestSession]);

    const value = useMemo(
        () => ({
            user,
            loading,
            pendingVerification,
            guestSession,
            refreshingSession,
            isLoggingOut,
            refreshSession,
            login,
            signup,
            googleSignIn,
            verifyEmail,
            resendVerificationEmail,
            logout,
            isAuthenticated: !isLoggingOut && !!user,
            isGuest: user?.role === 'guest',
        }),
        [user, loading, pendingVerification, guestSession, refreshingSession, isLoggingOut, refreshSession, login, signup, googleSignIn, verifyEmail, resendVerificationEmail, logout],
    );

    return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
    const ctx = useContext(AuthContext);
    if (!ctx) throw new Error('useAuth must be used within AuthProvider');
    return ctx;
}
