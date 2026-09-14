import { useEffect, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { useToast } from '../components/Toast';
import GoogleSignInButton, { isGoogleEnabled } from '../components/GoogleSignInButton';
import { BOTTLE_IMAGE_URL } from '../constants/hostedImages';
import { useAuth } from '../contexts/AuthContext';

export default function Login() {
    const [identifier, setIdentifier] = useState('');
    const [pass, setPass] = useState('');
    const [showPass, setShowPass] = useState(false);
    const [loading, setLoading] = useState(false);

    const { showToast } = useToast();
    const { login } = useAuth();
    const navigate = useNavigate();
    const location = useLocation();

    useEffect(() => {
        const flashMessage = location.state?.flashMessage;
        if (!flashMessage) return;

        showToast(flashMessage);
        navigate(location.pathname, { replace: true, state: null });
    }, [location.pathname, location.state, navigate, showToast]);

    const handleLogin = async (e) => {
        e.preventDefault();
        const loginIdentifier = identifier.trim();

        if (!loginIdentifier || !pass) {
            showToast('Please fill in both fields');
            return;
        }
        setLoading(true);
        try {
            const authData = await login({ identifier: loginIdentifier, password: pass });
            const user = authData.user;
            if (user?.role !== 'guest' && user && !user.emailVerified) {
                showToast('Login successful. You can continue browsing and verify your email later.');
                navigate(user.role === 'doctor' ? '/dashboard' : '/');
                return;
            }

            showToast(authData.message || 'Login successful!');
            if (user.role === 'doctor') {
                navigate('/dashboard');
            } else {
                navigate('/');
            }
        } catch (err) {
            showToast(err.message || 'Login failed');
        } finally {
            setLoading(false);
        }
    };

    const handleGoogleSuccess = (authData) => {
        const googleUser = authData?.user;
        showToast(authData?.message || 'Signed in with Google!');
        navigate(googleUser?.role === 'doctor' ? '/dashboard' : '/');
    };

    const handleGoogleError = (err) => {
        showToast(err?.message || 'Google sign-in failed');
    };

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
                        <div className="auth-card__header auth-card__header--login">
                            <h1 className="auth-heading">Login Now,</h1>
                            <p className="auth-subhead">Welcome back - your health dashboard is waiting.</p>
                        </div>
                        <form id="loginForm" className="auth-form" noValidate autoComplete="off" onSubmit={handleLogin}>
                            <div className="fg" id="fg-lemail">
                                <label className="fg__label" htmlFor="lEmail">Email or username</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="lEmail"
                                        type="text"
                                        className="fg__input"
                                        placeholder="Enter your email or username"
                                        autoComplete="username"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                    />
                                </div>
                            </div>
                            <div className="fg" id="fg-lpass">
                                <label className="fg__label" htmlFor="lPass">Password</label>
                                <div className="fg__input-wrap">
                                    <input
                                        id="lPass"
                                        type={showPass ? 'text' : 'password'}
                                        className="fg__input fg__input--padded"
                                        placeholder="Enter your password"
                                        autoComplete="current-password"
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
                            </div>
                            <div className="forgot-wrap">
                                <button type="button" className="forgot-link" onClick={() => navigate('/forgot-password')}>
                                    Forgot password?
                                </button>
                            </div>
                            <button type="submit" className={`auth-btn ${loading ? 'loading' : ''}`} id="authSubmitBtn" disabled={loading}>
                                <span className="auth-btn__text">Login</span>
                                <span className="auth-btn__spinner"></span>
                            </button>
                        </form>
                        {isGoogleEnabled && (
                            <>
                                <div className="auth-divider"><span>or</span></div>
                                <GoogleSignInButton
                                    text="signin_with"
                                    onSuccess={handleGoogleSuccess}
                                    onError={handleGoogleError}
                                />
                            </>
                        )}
                        <p className="auth-footer-link">
                            Need a user account? <Link to="/register" className="auth-link">Sign up</Link>
                        </p>
                        <p className="auth-footer-link auth-footer-link--secondary">
                            Doctor access? <Link to="/request-account" className="auth-link">Request account</Link>
                        </p>
                    </div>
                </div>
            </div>
        </div>
    );
}
