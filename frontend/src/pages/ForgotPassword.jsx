import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import { BOTTLE_IMAGE_URL } from '../constants/hostedImages';
import { authApi } from '../services/api';
import { useResendCooldown } from '../hooks/useResendCooldown';

const maskEmail = (email) => {
    if (!email || !email.includes('@')) return email;

    const [localPart, domain] = email.split('@');
    const visibleStart = localPart.slice(0, 2);
    const maskedLength = Math.max(localPart.length - 2, 1);
    return `${visibleStart}${'*'.repeat(maskedLength)}@${domain}`;
};

const validatePassword = (password) => {
    if (password.length < 12) return 'Password must be at least 12 characters';
    if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
    if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
    if (!/[0-9]/.test(password)) return 'Password must contain a number';
    if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) return 'Password must contain a special character';
    return null;
};

export default function ForgotPassword() {
    const [email, setEmail] = useState('');
    const [requestedEmail, setRequestedEmail] = useState('');
    const [otp, setOtp] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [showConfirmPassword, setShowConfirmPassword] = useState(false);
    const [requesting, setRequesting] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [resending, setResending] = useState(false);
    const { isLocked, label: cooldownLabel, start: startCooldown } = useResendCooldown();

    const { showToast } = useToast();
    const navigate = useNavigate();

    const codeRequested = Boolean(requestedEmail);

    const handleRequestCode = async (event) => {
        event.preventDefault();

        const sanitizedEmail = email.trim();
        if (!sanitizedEmail) {
            showToast('Enter your email address.');
            return;
        }

        setRequesting(true);
        try {
            const response = await authApi.requestPasswordReset(sanitizedEmail);
            setRequestedEmail(sanitizedEmail);
            startCooldown(60);
            showToast(response.message || 'A password reset code has been sent to your email.');
        } catch (error) {
            if (error.status === 429) {
                setRequestedEmail(sanitizedEmail);
                startCooldown(error.data?.retryAfter || 60);
            }
            showToast(error.message || 'Failed to request password reset code');
        } finally {
            setRequesting(false);
        }
    };

    const handleResetPassword = async (event) => {
        event.preventDefault();

        if (otp.trim().length !== 6) {
            showToast('Enter the 6-digit reset code.');
            return;
        }

        if (!newPassword || !confirmPassword) {
            showToast('Enter and confirm your new password.');
            return;
        }

        if (newPassword !== confirmPassword) {
            showToast('Passwords do not match.');
            return;
        }

        const passwordError = validatePassword(newPassword);
        if (passwordError) {
            showToast(passwordError);
            return;
        }

        setSubmitting(true);
        try {
            const response = await authApi.resetPassword({
                email: requestedEmail,
                otp: otp.trim(),
                newPassword,
            });

            navigate('/login', {
                replace: true,
                state: {
                    flashMessage: response.message || 'Password reset successfully. Please log in with your new password.',
                },
            });
        } catch (error) {
            showToast(error.message || 'Failed to reset password');
        } finally {
            setSubmitting(false);
        }
    };

    const handleResendCode = async () => {
        if (!requestedEmail) {
            showToast('Enter your email address first.');
            return;
        }

        setResending(true);
        try {
            const response = await authApi.requestPasswordReset(requestedEmail);
            setOtp('');
            startCooldown(60);
            showToast(response.message || 'A password reset code has been sent to your email.');
        } catch (error) {
            if (error.status === 429) {
                startCooldown(error.data?.retryAfter || 60);
            }
            showToast(error.message || 'Failed to resend reset code');
        } finally {
            setResending(false);
        }
    };

    const handleUseAnotherEmail = () => {
        setRequestedEmail('');
        setOtp('');
        setNewPassword('');
        setConfirmPassword('');
        setShowPassword(false);
        setShowConfirmPassword(false);
    };

    const handleOtpChange = (event) => {
        const sanitizedValue = event.target.value.replace(/\D/g, '').slice(0, 6);
        setOtp(sanitizedValue);
    };

    const renderPasswordToggle = (isVisible, onToggle, label) => (
        <button
            type="button"
            className="eye-btn"
            aria-label={label}
            onClick={onToggle}
        >
            {!isVisible ? (
                <svg className="eye-icon eye-on" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                </svg>
            ) : (
                <svg className="eye-icon eye-off" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
                </svg>
            )}
        </button>
    );

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
                            <span className="verify-email-badge">Password reset</span>
                            <h1 className="auth-heading">{codeRequested ? 'Choose a new password' : 'Forgot your password?'}</h1>
                            <p className="auth-subhead">
                                {codeRequested
                                    ? <>Enter the 6-digit code sent to <strong>{maskEmail(requestedEmail)}</strong>, then set a new password.</>
                                    : 'Enter the email address on your account and we will send you a one-time reset code.'}
                            </p>
                        </div>

                        {!codeRequested ? (
                            <form className="auth-form" noValidate autoComplete="off" onSubmit={handleRequestCode}>
                                <div className="fg">
                                    <label className="fg__label" htmlFor="forgotEmail">Email Address</label>
                                    <div className="fg__input-wrap">
                                        <input
                                            id="forgotEmail"
                                            type="email"
                                            className="fg__input"
                                            placeholder="Enter your email address"
                                            autoComplete="email"
                                            value={email}
                                            onChange={(event) => setEmail(event.target.value)}
                                        />
                                    </div>
                                </div>

                                <button type="submit" className={`auth-btn ${requesting ? 'loading' : ''}`} disabled={requesting}>
                                    <span className="auth-btn__text">Send reset code</span>
                                    <span className="auth-btn__spinner"></span>
                                </button>
                            </form>
                        ) : (
                            <>
                                <form className="auth-form" noValidate autoComplete="off" onSubmit={handleResetPassword}>
                                    <div className="verify-email-meta">
                                        <span>Reset email</span>
                                        <strong>{maskEmail(requestedEmail)}</strong>
                                    </div>

                                    <div className="fg">
                                        <label className="fg__label" htmlFor="resetOtp">Reset Code</label>
                                        <div className="fg__input-wrap">
                                            <input
                                                id="resetOtp"
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

                                    <div className="fg">
                                        <label className="fg__label" htmlFor="resetNewPassword">New Password</label>
                                        <div className="fg__input-wrap">
                                            <input
                                                id="resetNewPassword"
                                                type={showPassword ? 'text' : 'password'}
                                                className="fg__input fg__input--padded"
                                                placeholder="Create a new password"
                                                autoComplete="new-password"
                                                value={newPassword}
                                                onChange={(event) => setNewPassword(event.target.value)}
                                            />
                                            {renderPasswordToggle(
                                                showPassword,
                                                () => setShowPassword((value) => !value),
                                                'Show or hide new password'
                                            )}
                                        </div>
                                    </div>

                                    <div className="fg">
                                        <label className="fg__label" htmlFor="resetConfirmPassword">Confirm New Password</label>
                                        <div className="fg__input-wrap">
                                            <input
                                                id="resetConfirmPassword"
                                                type={showConfirmPassword ? 'text' : 'password'}
                                                className="fg__input fg__input--padded"
                                                placeholder="Confirm your new password"
                                                autoComplete="new-password"
                                                value={confirmPassword}
                                                onChange={(event) => setConfirmPassword(event.target.value)}
                                            />
                                            {renderPasswordToggle(
                                                showConfirmPassword,
                                                () => setShowConfirmPassword((value) => !value),
                                                'Show or hide confirm password'
                                            )}
                                        </div>
                                    </div>

                                    <button type="submit" className={`auth-btn ${submitting ? 'loading' : ''}`} disabled={submitting}>
                                        <span className="auth-btn__text">Reset password</span>
                                        <span className="auth-btn__spinner"></span>
                                    </button>
                                </form>

                                <div className="verify-email-actions">
                                    <button
                                        type="button"
                                        className="verify-email-secondary"
                                        onClick={handleResendCode}
                                        disabled={resending || isLocked}
                                    >
                                        {resending
                                            ? 'Sending...'
                                            : isLocked
                                                ? `Resend code in ${cooldownLabel}`
                                                : 'Resend code'}
                                    </button>
                                    <button
                                        type="button"
                                        className="verify-email-secondary"
                                        onClick={handleUseAnotherEmail}
                                    >
                                        Use another email
                                    </button>
                                </div>
                            </>
                        )}

                        <p className="verify-email-note">
                            Remembered it? Go back to <Link to="/login" className="auth-link">login</Link>.
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
