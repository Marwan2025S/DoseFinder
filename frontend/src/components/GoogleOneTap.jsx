import { useCallback, useEffect, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from './Toast';
import { GOOGLE_CLIENT_ID, isGoogleEnabled, waitForGoogleScript } from '../services/googleIdentity';

// Pages that already show the explicit "Sign in with Google" button — One Tap is
// suppressed here to avoid duplicate prompts.
const AUTH_ROUTES = ['/login', '/register', '/request-account', '/forgot-password', '/verify-email'];

/**
 * Renders Google One Tap site-wide for signed-out visitors (guests). It reuses the
 * same credential -> backend exchange as the button (AuthContext.googleSignIn), so a
 * One Tap confirmation upgrades the current guest into a real account.
 *
 * One Tap is the only GIS surface active on non-auth pages, and the button is the
 * only one on auth pages, so google.accounts.id.initialize() never has two owners on
 * the same page. Renders nothing into the DOM (Google draws the prompt itself).
 */
export default function GoogleOneTap() {
    const { user, googleSignIn, loading, isLoggingOut } = useAuth();
    const { showToast } = useToast();
    const location = useLocation();

    const isGuest = !user || user.role === 'guest';
    const onAuthPage = AUTH_ROUTES.some((route) => location.pathname.startsWith(route));
    const shouldPrompt = isGoogleEnabled && !loading && !isLoggingOut && isGuest && !onAuthPage;

    // Keep the latest dependencies in a ref so the GIS callback never goes stale.
    const handlersRef = useRef({ googleSignIn, showToast });
    handlersRef.current = { googleSignIn, showToast };

    const handleCredential = useCallback(async (response) => {
        const { googleSignIn: doGoogleSignIn, showToast: toast } = handlersRef.current;
        if (!response?.credential) return;

        try {
            const authData = await doGoogleSignIn(response.credential);
            // Route guards (e.g. HomeRoute) react to the new auth state on their own;
            // no manual navigation needed here.
            toast(authData?.message || 'Signed in with Google!');
        } catch (error) {
            toast(error?.message || 'Google sign-in failed', 'error');
        }
    }, []);

    useEffect(() => {
        if (!isGoogleEnabled) return undefined;

        if (!shouldPrompt) {
            window.google?.accounts?.id?.cancel?.();
            return undefined;
        }

        let cancelled = false;
        waitForGoogleScript()
            .then((googleId) => {
                if (cancelled) return;
                googleId.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: handleCredential,
                    auto_select: false,            // never sign in silently — user taps to confirm
                    cancel_on_tap_outside: false,
                    use_fedcm_for_prompt: true,    // FedCM-native One Tap (Chrome/Edge)
                    itp_support: true,             // upgraded One Tap UX on ITP browsers (Safari): secure interim welcome page + popup instead of a blocked request
                    context: 'signin',
                });
                googleId.prompt();
            })
            .catch(() => {
                // GIS unavailable (offline/blocked) — silently skip One Tap.
            });

        return () => {
            cancelled = true;
            window.google?.accounts?.id?.cancel?.();
        };
    }, [shouldPrompt, handleCredential]);

    return null;
}
