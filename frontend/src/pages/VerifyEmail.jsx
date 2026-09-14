import { useMemo, useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { BOTTLE_IMAGE_URL } from '../constants/hostedImages';
import { useAuth } from '../contexts/AuthContext';
import { useResendCooldown } from '../hooks/useResendCooldown';

const maskEmail = (email) => {
    if (!email || !email.includes('@')) return email;

    const [localPart, domain] = email.split('@');
    const visibleStart = localPart.slice(0, 2);
    const maskedLength = Math.max(localPart.length - 2, 1);
    return `${visibleStart}${'*'.repeat(maskedLength)}@${domain}`;
};

export default function VerifyEmail() {
    const [otp, setOtp] = useState('');
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const { isLocked, label: cooldownLabel, start: startCooldown } = useResendCooldown();

    const navigate = useNavigate();
    const { showToast } = useToast();
    const {
        user,
        pendingVerification,
        isAuthenticated,
        verifyEmail,
        resendVerificationEmail,
        logout
    } = useAuth();

    const verificationEmail = pendingVerification?.email || user?.email || '';
    const verificationName = pendingVerification?.username || user?.username || 'there';

    const redirectPath = useMemo(() => {
        return user?.role === 'doctor' ? '/dashboard' : '/';
    }, [user?.role]);

    const canAccessPage = Boolean(verificationEmail) && (
        pendingVerification?.email ||
        (user && user.role !== 'guest' && !user.emailVerified)
    );

    if (!canAccessPage) {
        return <Navigate to={isAuthenticated ? redirectPath : '/login'} replace />;
    }

    const handleVerify = async (event) => {
        event.preventDefault();

        if (otp.trim().length !== 6) {
            showToast('Enter the 6-digit verification code.');
            return;
        }

        setSubmitting(true);
        try {
            const response = await verifyEmail({ email: verificationEmail, otp: otp.trim() });
            showToast(response.message || 'Email verified successfully.');
            navigate(redirectPath, { replace: true });
        } catch (error) {
            showToast(error.message || 'Verification failed');
        } finally {
            setSubmitting(false);
        }
    };

    const handleResend = async () => {
        if (!verificationEmail) {
            showToast('Missing verification email address.');
            return;
        }

        setResending(true);
        try {
            const response = await resendVerificationEmail(verificationEmail);
            startCooldown(60);
            showToast(response.message || 'A new verification code has been sent.');
        } catch (error) {
            if (error.status === 429) {
                startCooldown(error.data?.retryAfter || 60);
            }
            showToast(error.message || 'Failed to resend verification code');
        } finally {
            setResending(false);
        }
    };

    const handleOtpChange = (event) => {
        const sanitizedValue = event.target.value.replace(/\D/g, '').slice(0, 6);
        setOtp(sanitizedValue);
    };

    return (
        <div className="auth-body">
            <div className="auth-wrap">
                <div className="auth-panel auth-panel--left">
                    <img
                        id="bottleImg"
                        className="illus-full"
                        src={BOTTLE_IMAGE_URL}
                        alt="Medicine bottle with blue pills"
                    />
                </div>
                <div className="auth-panel auth-panel--right">
                    <div className="auth-card auth-card--verify">
                        <div className="auth-card__header">
                            <span className="verify-email-badge">Email verification</span>
                            <h1 className="auth-heading">Confirm your inbox</h1>
                            <p className="auth-subhead">
                                Enter the 6-digit code sent to <strong>{maskEmail(verificationEmail)}</strong> to finish setting up your account.
                            </p>
                        </div>

                        <form className="auth-form" noValidate autoComplete="off" onSubmit={handleVerify}>
                            <div className="verify-email-meta">
                                <span>Account</span>
                                <strong>{verificationName}</strong>
                            </div>

                            <div className="fg">
                                <label className="fg__label" htmlFor="emailOtp">Verification Code</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="emailOtp"
                                        type="text"
                                        inputMode="numeric"
                                        className="fg__input verify-email-code"
                                        placeholder="000000"
                                        autoComplete="one-time-code"
                                        value={otp}
                                        onChange={handleOtpChange}
                                    />
                                </div>
                            </div>

                            <button type="submit" className={`auth-btn ${submitting ? 'loading' : ''}`} disabled={submitting}>
                                <span className="auth-btn__text">Verify Email</span>
                                <span className="auth-btn__spinner"></span>
                            </button>
                        </form>

                        <div className="verify-email-actions">
                            <button
                                type="button"
                                className="verify-email-secondary"
                                onClick={handleResend}
                                disabled={resending || isLocked}
                            >
                                {resending
                                    ? 'Sending...'
                                    : isLocked
                                        ? `Resend code in ${cooldownLabel}`
                                        : 'Resend code'}
                            </button>
                            <button type="button" className="verify-email-secondary" onClick={logout}>
                                Use another account
                            </button>
                        </div>

                        <p className="verify-email-note">
                            Didn&apos;t get it? Check your spam folder or request another code. If you need to switch accounts, choose <strong>Use another account</strong> to sign out first.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
