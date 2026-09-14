import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_COOLDOWN_SECONDS = 60;

const formatLabel = (totalSeconds) => {
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

// Drives a countdown for "Resend code" buttons. `start(seconds)` begins (or
// restarts) the lock; `secondsLeft` ticks down to 0, and `label` is a mm:ss
// string suitable for the button text. The backend remains authoritative — call
// `start(retryAfter)` when a 429 response reports remaining cooldown.
export function useResendCooldown(defaultSeconds = DEFAULT_COOLDOWN_SECONDS) {
    const [secondsLeft, setSecondsLeft] = useState(0);
    const intervalRef = useRef(null);

    const clear = useCallback(() => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current);
            intervalRef.current = null;
        }
    }, []);

    const start = useCallback((seconds = defaultSeconds) => {
        const initial = Math.max(0, Math.ceil(Number(seconds) || 0));
        clear();
        setSecondsLeft(initial);
        if (initial <= 0) {
            return;
        }
        intervalRef.current = setInterval(() => {
            setSecondsLeft((current) => {
                if (current <= 1) {
                    clear();
                    return 0;
                }
                return current - 1;
            });
        }, 1000);
    }, [clear, defaultSeconds]);

    useEffect(() => clear, [clear]);

    return {
        secondsLeft,
        isLocked: secondsLeft > 0,
        label: formatLabel(secondsLeft),
        start,
    };
}

export default useResendCooldown;
