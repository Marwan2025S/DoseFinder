import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { GOOGLE_CLIENT_ID, isGoogleEnabled, waitForGoogleScript } from '../services/googleIdentity';

// Re-exported so pages can gate the "or" divider on the same flag from one import.
export { isGoogleEnabled };

/**
 * Renders the official "Sign in with Google" button. Handles the Google Identity
 * Services plumbing, exchanges the returned credential with our backend via
 * AuthContext, then hands the result back to the page through onSuccess/onError.
 *
 * Renders nothing when VITE_GOOGLE_CLIENT_ID is not configured.
 */
export default function GoogleSignInButton({ text = 'signin_with', onSuccess, onError }) {
    const { googleSignIn } = useAuth();
    const containerRef = useRef(null);
    const [pending, setPending] = useState(false);

    // Keep the latest callbacks in refs so the GIS callback never goes stale.
    const handlersRef = useRef({ googleSignIn, onSuccess, onError, pending });
    handlersRef.current = { googleSignIn, onSuccess, onError, pending };

    const handleCredential = useCallback(async (response) => {
        const { googleSignIn: doGoogleSignIn, onSuccess: handleSuccess, onError: handleError, pending: isPending } = handlersRef.current;
        if (isPending) return;
        if (!response?.credential) {
            handleError?.(new Error('No credential returned from Google'));
            return;
        }

        setPending(true);
        try {
            const authData = await doGoogleSignIn(response.credential);
            handleSuccess?.(authData);
        } catch (error) {
            handleError?.(error);
        } finally {
            setPending(false);
        }
    }, []);

    useEffect(() => {
        if (!GOOGLE_CLIENT_ID || !containerRef.current) return undefined;

        let cancelled = false;
        waitForGoogleScript()
            .then((googleId) => {
                if (cancelled || !containerRef.current) return;

                googleId.initialize({
                    client_id: GOOGLE_CLIENT_ID,
                    callback: handleCredential,
                });

                const width = Math.min(Math.max(containerRef.current.offsetWidth || 320, 200), 400);
                googleId.renderButton(containerRef.current, {
                    type: 'standard',
                    theme: 'outline',
                    size: 'large',
                    text,
                    shape: 'rectangular',
                    logo_alignment: 'left',
                    width,
                });
            })
            .catch((error) => {
                if (!cancelled) handlersRef.current.onError?.(error);
            });

        return () => {
            cancelled = true;
        };
    }, [handleCredential, text]);

    if (!GOOGLE_CLIENT_ID) return null;

    return (
        <div className={`google-signin ${pending ? 'google-signin--pending' : ''}`}>
            <div ref={containerRef} className="google-signin__button" aria-busy={pending} />
        </div>
    );
}
