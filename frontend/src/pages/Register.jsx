import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import GoogleSignInButton, { isGoogleEnabled } from '../components/GoogleSignInButton';
import { BOTTLE_IMAGE_URL } from '../constants/hostedImages';
import { useAuth } from '../contexts/AuthContext';

const ACCOUNT_COPY = {
    user: {
        heading: 'Create an account',
        subhead: 'Join DoseFinder and manage your health smarter.',
        submitLabel: 'Create an account',
        successFallback: 'Account created successfully. You can verify your email later.',
        footerPrompt: 'Are you a doctor?',
        footerLink: 'Request account',
        footerTo: '/request-account',
    },
    doctor: {
        heading: 'Request account',
        subhead: 'Request a DoseFinder doctor account for medication review access.',
        submitLabel: 'Request account',
        successFallback: 'Doctor account request submitted successfully. Approval is required before drug changes are enabled.',
        footerPrompt: 'Need a user account?',
        footerLink: 'Sign up',
        footerTo: '/register',
    },
};

export default function Register({ accountType = 'user' }) {
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [pass, setPass] = useState('');
    const [confirm, setConfirm] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [showConfirm, setShowConfirm] = useState(false);
    const [loading, setLoading] = useState(false);

    const normalizedAccountType = accountType === 'doctor' ? 'doctor' : 'user';
    const copy = ACCOUNT_COPY[normalizedAccountType];
    const { showToast } = useToast();
    const { signup } = useAuth();
    const navigate = useNavigate();

    const validatePassword = (p) => {
        if (p.length < 12) return 'Password must be at least 12 characters';
        if (!/[A-Z]/.test(p)) return 'Password must contain an uppercase letter';
        if (!/[a-z]/.test(p)) return 'Password must contain a lowercase letter';
        if (!/[0-9]/.test(p)) return 'Password must contain a number';
        if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(p)) return 'Password must contain a special character';
        return null;
    };

    const getStrengthWord = (p) => {
        if (p.length === 0) return '';
        if (p.length < 8) return 'Weak';
        if (p.length < 12) return 'Fair';
        const passErr = validatePassword(p);
        return passErr ? 'Fair' : 'Strong';
    };

    const getStrengthPercent = (p) => {
        if (p.length === 0) return 0;
        if (p.length < 8) return 33;
        if (p.length < 12) return 66;
        return 100;
    };

    const getStrengthColor = (s) => {
        if (s === 'Weak') return '#ef4444';
        if (s === 'Fair') return '#fbbf24';
        return '#22c55e';
    };

    const handleRegister = async (e) => {
        e.preventDefault();
        if (!name || !email || !pass || !confirm) {
            showToast('Please fill in all fields');
            return;
        }
        if (pass !== confirm) {
            showToast('Passwords do not match');
            return;
        }
        const passError = validatePassword(pass);
        if (passError) {
            showToast(passError);
            return;
        }
        setLoading(true);
        try {
            const result = await signup({ username: name, email, password: pass, role: normalizedAccountType });
            showToast(result.message || copy.successFallback);
            navigate('/');
        } catch (err) {
            showToast(err.message || (normalizedAccountType === 'doctor' ? 'Account request failed' : 'Registration failed'));
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSuccess = (authData) => {
        const googleUser = authData?.user;
        showToast(authData?.message || 'Account created with Google!');
        navigate(googleUser?.role === 'doctor' ? '/dashboard' : '/');
    };

    const handleGoogleError = (err) => {
        showToast(err?.message || 'Google sign-in failed');
    };

    const strengthWord = getStrengthWord(pass);
    const strengthColor = getStrengthColor(strengthWord);

    return (
        <div className="auth-body">
            <div className="auth-wrap">
                <div className="auth-topbar">
                    <Link to="/" className="auth-brand">
                        Dose<span>Finder</span>
                    </Link>
                    <button
                        type="button"
                        className="auth-close-btn"
                        aria-label="Close and return to home"
                        onClick={() => navigate('/')}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <path d="M6 6L18 18" />
                            <path d="M18 6L6 18" />
                        </svg>
                    </button>
                </div>
                <div className="auth-panel auth-panel--left">
                    <img
                        id="bottleImg"
                        className="illus-full"
                        src={BOTTLE_IMAGE_URL}
                        alt="Medicine bottle with blue pills"
                    />
                </div>
                <div className="auth-panel auth-panel--right">
                    <div className="auth-card" id="authCard">
                        <div className="auth-card__header">
                            <h1 className="auth-heading">{copy.heading}</h1>
                            <p className="auth-subhead">{copy.subhead}</p>
                        </div>
                        <form id="registerForm" className="auth-form" noValidate autoComplete="off" onSubmit={handleRegister}>
                            <div className="fg" id="fg-name">
                                <label className="fg__label" htmlFor="rName">Username</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="rName"
                                        type="text"
                                        className="fg__input"
                                        placeholder="Choose a username"
                                        autoComplete="username"
                                        value={name}
                                        onChange={(e) => setName(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="fg" id="fg-email">
                                <label className="fg__label" htmlFor="rEmail">Email Address</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="rEmail"
                                        type="email"
                                        className="fg__input"
                                        placeholder="Enter your email address"
                                        autoComplete="email"
                                        value={email}
                                        onChange={(e) => setEmail(e.target.value)}
                                    />
                                </div>
                            </div>
                            {normalizedAccountType === 'doctor' && (
                                <p className="account-type-hint">
                                    Doctor accounts can sign in immediately, but add/edit drug actions stay locked until approval.
                                </p>
                            )}
                            <div className="fg" id="fg-pass">
                                <label className="fg__label" htmlFor="rPass">Password</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="rPass"
                                        type={showPass ? 'text' : 'password'}
                                        className="fg__input fg__input--padded"
                                        placeholder="Create your password (min 12 chars)"
                                        autoComplete="new-password"
                                        value={pass}
                                        onChange={(e) => setPass(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        className="eye-btn"
                                        aria-label="Show/hide password"
                                        onClick={() => setShowPass(!showPass)}
                                    >
                                        {!showPass ? (
                                            <svg className="eye-icon eye-on" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                            </svg>
                                        ) : (
                                            <svg className="eye-icon eye-off" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                                <div className="strength-meter">
                                    <div className="strength-meter__track">
                                        <div className="strength-meter__fill" id="sFill" style={{ width: getStrengthPercent(pass) + '%', backgroundColor: strengthColor }}></div>
                                    </div>
                                    <span className="strength-meter__label" id="sLabel" style={{ color: strengthColor }}>{strengthWord}</span>
                                </div>
                            </div>
                            <div className="fg" id="fg-confirm">
                                <label className="fg__label" htmlFor="rConfirm">Confirm Password</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="rConfirm"
                                        type={showConfirm ? 'text' : 'password'}
                                        className="fg__input fg__input--padded"
                                        placeholder="Confirm your password"
                                        autoComplete="new-password"
                                        value={confirm}
                                        onChange={(e) => setConfirm(e.target.value)}
                                    />
                                    <button
                                        type="button"
                                        className="eye-btn"
                                        aria-label="Show/hide confirm password"
                                        onClick={() => setShowConfirm(!showConfirm)}
                                    >
                                        {!showConfirm ? (
                                            <svg className="eye-icon eye-on" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" />
                                            </svg>
                                        ) : (
                                            <svg className="eye-icon eye-off" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                                <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" /><line x1="1" y1="1" x2="23" y2="23" />
                                            </svg>
                                        )}
                                    </button>
                                </div>
                            </div>
                            <button type="submit" className={`auth-btn ${loading ? 'loading' : ''}`} id="authSubmitBtn" disabled={loading}>
                                <span className="auth-btn__text">{copy.submitLabel}</span>
                                <span className="auth-btn__spinner"></span>
                            </button>
                        </form>
                        {isGoogleEnabled && normalizedAccountType === 'user' && (
                            <>
                                <div className="auth-divider"><span>or</span></div>
                                <GoogleSignInButton
                                    text="signup_with"
                                    onSuccess={handleGoogleSuccess}
                                    onError={handleGoogleError}
                                />
                            </>
                        )}
                        <p className="auth-footer-link">
                            {copy.footerPrompt} <Link to={copy.footerTo} className="auth-link">{copy.footerLink}</Link>
                        </p>
                        <p className="auth-footer-link auth-footer-link--secondary">
                            Already have an account? <Link to="/login" className="auth-link">Login</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
