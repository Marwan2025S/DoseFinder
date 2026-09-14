// Shared helpers for Google Identity Services (GIS). The GIS client library is
// loaded once in index.html; both the "Sign in with Google" button and the One Tap
// prompt build on these.

export const GOOGLE_CLIENT_ID = import.meta.env.VITE_GOOGLE_CLIENT_ID;

// True when a Google OAuth client ID is configured. UI uses this to decide whether
// to render Google sign-in surfaces at all.
export const isGoogleEnabled = Boolean(GOOGLE_CLIENT_ID);

// Resolves once the GIS script (accounts.google.com/gsi/client) has loaded and
// window.google.accounts.id is available. Rejects after timeoutMs.
export function waitForGoogleScript(timeoutMs = 8000) {
    return new Promise((resolve, reject) => {
        if (window.google?.accounts?.id) {
            resolve(window.google.accounts.id);
            return;
        }

        const startedAt = Date.now();
        const timer = setInterval(() => {
            if (window.google?.accounts?.id) {
                clearInterval(timer);
                resolve(window.google.accounts.id);
            } else if (Date.now() - startedAt > timeoutMs) {
                clearInterval(timer);
                reject(new Error('Google sign-in failed to load'));
            }
        }, 100);
    });
}
