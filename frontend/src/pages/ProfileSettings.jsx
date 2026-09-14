import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppLayout from '../components/AppLayout';
import Footer from '../components/Footer';
import Navbar from '../components/Navbar';
import ConfirmDialog from '../components/ConfirmDialog';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { profileApi } from '../services/api';
import { getUserDisplayName, getUserInitials } from '../utils/userDisplay';
import '../styles/profile-settings.css';

const validatePassword = (password) => {
  if (password.length < 12) return 'Password must be at least 12 characters';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  if (!/[!@#$%^&*()_+\-=[\]{};':"\\|,.<>/?]/.test(password)) return 'Password must contain a special character';
  return null;
};

const validateEmail = (email) => {
  if (!email.trim()) return 'Enter your new email address.';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) return 'Enter a valid email address.';
  return null;
};

const formatMemberSince = (value) => {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';

  return new Intl.DateTimeFormat('en', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  }).format(date);
};

const getAccountStatus = (profile) => {
  if (profile?.role !== 'doctor') return 'Patient account';
  return profile?.verifiedDoctor ? 'Approved doctor' : 'Doctor approval pending';
};

function SettingsContent({
  user,
  profile,
  loading,
  profileForm,
  emailChangeForm,
  passwordForm,
  isProfileDirty,
  isPasswordDirty,
  canAttemptEmailRequest,
  canAttemptEmailConfirm,
  canAttemptPasswordSubmit,
  canAttemptPasswordCreate,
  showEmailCurrentPassword,
  showCurrentPassword,
  showNewPassword,
  showConfirmPassword,
  profileSaving,
  emailChangeRequesting,
  emailChangeConfirming,
  passwordSaving,
  onProfileFieldChange,
  onEmailChangeFieldChange,
  onPasswordFieldChange,
  onToggleEmailCurrentPassword,
  onToggleCurrentPassword,
  onToggleNewPassword,
  onToggleConfirmPassword,
  onProfileSubmit,
  onEmailChangeRequest,
  onEmailChangeConfirm,
  onCancelEmailChange,
  onVerifyEmail,
  onPasswordSubmit,
  onCreatePasswordSubmit,
  onLogout,
}) {
  const displayName = getUserDisplayName(profile ?? user);
  const initials = getUserInitials(profile ?? user);
  const accountStatus = getAccountStatus(profile);
  const emailStatusLabel = profile?.emailVerified ? 'Email verified' : 'Email pending';
  const hasPassword = Boolean(profile?.hasPassword);
  const passwordCardTitle = hasPassword ? 'Change Password' : 'Create Password';
  const passwordSubmitLabel = hasPassword ? 'Update password' : 'Create password';
  const passwordCardCopy = hasPassword
    ? 'Keep this form compact and use it only when you want to replace your current password.'
    : 'You sign in with Google. Create a password to also log in with your email and password.';
  const passwordSubmitDisabled = hasPassword
    ? (passwordSaving || !isPasswordDirty || !canAttemptPasswordSubmit)
    : (passwordSaving || !canAttemptPasswordCreate);

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
    <section className="settings-page">
      <div className="settings-page__hero">
        <div className="settings-page__avatar" aria-hidden="true">{initials}</div>
        <div className="settings-page__hero-copy">
          <span className="settings-page__eyebrow">Profile & Settings</span>
          <h1 className="settings-page__title">{displayName}</h1>
          <p className="settings-page__subtitle">
            Manage your public account details and security from one compact page.
          </p>
          <div className="settings-page__meta">
            <span className="settings-page__meta-chip">{accountStatus}</span>
            <span className="settings-page__meta-chip">{emailStatusLabel}</span>
            <span className="settings-page__meta-chip">{profile?.role ? `${profile.role} account` : 'Account'}</span>
          </div>
        </div>
      </div>

      {loading ? (
        <div className="settings-card settings-card--loading">
          <div className="auth-btn__spinner" style={{ width: 28, height: 28, borderWidth: 3 }}></div>
        </div>
      ) : (
        <div className="settings-grid">
          <section className="settings-card settings-card--wide">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">Account Details</h2>
                <p className="settings-card__copy">Edit the fields that can change, and keep the rest of your account details visible beside them.</p>
              </div>
            </div>

            <div className="settings-profile-layout">
              <form className="settings-form settings-form--compact" onSubmit={onProfileSubmit}>
                <span className="settings-form__section-label">Editable fields</span>

                <label className="settings-form__field">
                  <span className="settings-form__label">Display name</span>
                  <input
                    type="text"
                    className="settings-form__input"
                    value={profileForm.displayName}
                    onChange={(event) => onProfileFieldChange('displayName', event.target.value)}
                    placeholder="Enter your display name"
                  />
                </label>

                <label className="settings-form__field">
                  <span className="settings-form__label">Username</span>
                  <input
                    type="text"
                    className="settings-form__input"
                    value={profileForm.username}
                    onChange={(event) => onProfileFieldChange('username', event.target.value)}
                    placeholder="Enter your username"
                  />
                </label>

                <div className="settings-form__actions">
                  <button
                    type="submit"
                    className={`auth-btn settings-form__submit settings-form__submit--compact ${profileSaving ? 'loading' : ''}`}
                    disabled={profileSaving || !isProfileDirty || !profileForm.username.trim() || !profileForm.displayName.trim()}
                  >
                    <span className="auth-btn__text">Save profile</span>
                    <span className="auth-btn__spinner"></span>
                  </button>
                  <span className="settings-form__helper">
                    {isProfileDirty ? 'You have unsaved profile changes.' : 'No profile changes yet.'}
                  </span>
                </div>
              </form>

              <div className="settings-info-grid">
                <article className="settings-info-card">
                  <span className="settings-info-card__label">Email</span>
                  <strong className="settings-info-card__value">{profile?.email || '—'}</strong>
                  <p className="settings-info-card__hint">Email changes are not available from this page.</p>
                </article>

                <article className="settings-info-card">
                  <span className="settings-info-card__label">Role</span>
                  <strong className="settings-info-card__value">{profile?.role || '—'}</strong>
                  <p className="settings-info-card__hint">Role is assigned by the system.</p>
                </article>

                <article className="settings-info-card">
                  <span className="settings-info-card__label">Email status</span>
                  <strong className="settings-info-card__value">{profile?.emailVerified ? 'Verified' : 'Pending verification'}</strong>
                  <p className="settings-info-card__hint">
                    {profile?.emailVerified ? 'Your current inbox is confirmed.' : 'Confirm your inbox when you are ready.'}
                  </p>
                  {!profile?.emailVerified && (
                    <button type="button" className="settings-verify-email-btn" onClick={onVerifyEmail}>
                      Verify email
                    </button>
                  )}
                </article>

                <article className="settings-info-card">
                  <span className="settings-info-card__label">Member since</span>
                  <strong className="settings-info-card__value">{formatMemberSince(profile?.created_at)}</strong>
                  <p className="settings-info-card__hint">Your account creation date.</p>
                </article>
              </div>
            </div>
          </section>

          <section className="settings-card settings-card--wide">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">Change Email</h2>
                <p className="settings-card__copy">Confirm a new inbox with a one-time code before it replaces your current email.</p>
              </div>
            </div>

            {!emailChangeForm.pendingEmail ? (
              <form className="settings-form settings-form--email" onSubmit={onEmailChangeRequest}>
                <label className="settings-form__field">
                  <span className="settings-form__label">New email</span>
                  <input
                    type="email"
                    className="settings-form__input"
                    value={emailChangeForm.newEmail}
                    onChange={(event) => onEmailChangeFieldChange('newEmail', event.target.value)}
                    autoComplete="email"
                    placeholder="Enter your new email"
                  />
                </label>

                <label className="settings-form__field">
                  <span className="settings-form__label">Current password</span>
                  <div className="settings-form__input-wrap">
                    <input
                      type={showEmailCurrentPassword ? 'text' : 'password'}
                      className="settings-form__input fg__input--padded"
                      value={emailChangeForm.currentPassword}
                      onChange={(event) => onEmailChangeFieldChange('currentPassword', event.target.value)}
                      autoComplete="current-password"
                      placeholder="Enter your current password"
                    />
                    {renderPasswordToggle(showEmailCurrentPassword, onToggleEmailCurrentPassword, 'Show or hide current password for email change')}
                  </div>
                </label>

                <div className="settings-form__actions">
                  <button
                    type="submit"
                    className={`auth-btn settings-form__submit settings-form__submit--compact ${emailChangeRequesting ? 'loading' : ''}`}
                    disabled={emailChangeRequesting || !canAttemptEmailRequest}
                  >
                    <span className="auth-btn__text">Send code</span>
                    <span className="auth-btn__spinner"></span>
                  </button>
                  <span className="settings-form__helper">
                    Your current email stays active until the new email is verified.
                  </span>
                </div>
              </form>
            ) : (
              <form className="settings-form settings-form--email" onSubmit={onEmailChangeConfirm}>
                <div className="settings-email-pending">
                  <span>Pending email</span>
                  <strong>{emailChangeForm.pendingEmail}</strong>
                </div>

                <label className="settings-form__field">
                  <span className="settings-form__label">Verification code</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    className="settings-form__input settings-form__input--otp"
                    value={emailChangeForm.otp}
                    onChange={(event) => onEmailChangeFieldChange('otp', event.target.value)}
                    autoComplete="one-time-code"
                    placeholder="000000"
                  />
                </label>

                <div className="settings-form__actions">
                  <button
                    type="submit"
                    className={`auth-btn settings-form__submit settings-form__submit--compact ${emailChangeConfirming ? 'loading' : ''}`}
                    disabled={emailChangeConfirming || !canAttemptEmailConfirm}
                  >
                    <span className="auth-btn__text">Confirm email</span>
                    <span className="auth-btn__spinner"></span>
                  </button>
                  <button
                    type="button"
                    className="settings-secondary-btn"
                    onClick={onCancelEmailChange}
                    disabled={emailChangeConfirming}
                  >
                    Use another email
                  </button>
                </div>
              </form>
            )}
          </section>

          <section className="settings-card settings-card--wide">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">{passwordCardTitle}</h2>
                <p className="settings-card__copy">{passwordCardCopy}</p>
              </div>
            </div>

            <form className="settings-form settings-form--password" onSubmit={hasPassword ? onPasswordSubmit : onCreatePasswordSubmit}>
              {hasPassword && (
                <label className="settings-form__field">
                  <span className="settings-form__label">Current password</span>
                  <div className="settings-form__input-wrap">
                    <input
                      type={showCurrentPassword ? 'text' : 'password'}
                      className="settings-form__input fg__input--padded"
                      value={passwordForm.currentPassword}
                      onChange={(event) => onPasswordFieldChange('currentPassword', event.target.value)}
                      autoComplete="current-password"
                      placeholder="Enter your current password"
                    />
                    {renderPasswordToggle(showCurrentPassword, onToggleCurrentPassword, 'Show or hide current password')}
                  </div>
                </label>
              )}

              <label className="settings-form__field">
                <span className="settings-form__label">New password</span>
                <div className="settings-form__input-wrap">
                  <input
                    type={showNewPassword ? 'text' : 'password'}
                    className="settings-form__input fg__input--padded"
                    value={passwordForm.newPassword}
                    onChange={(event) => onPasswordFieldChange('newPassword', event.target.value)}
                    autoComplete="new-password"
                    placeholder="Create a new password"
                  />
                  {renderPasswordToggle(showNewPassword, onToggleNewPassword, 'Show or hide new password')}
                </div>
              </label>

              <label className="settings-form__field">
                <span className="settings-form__label">Confirm new password</span>
                <div className="settings-form__input-wrap">
                  <input
                    type={showConfirmPassword ? 'text' : 'password'}
                    className="settings-form__input fg__input--padded"
                    value={passwordForm.confirmPassword}
                    onChange={(event) => onPasswordFieldChange('confirmPassword', event.target.value)}
                    autoComplete="new-password"
                    placeholder="Confirm your new password"
                  />
                  {renderPasswordToggle(showConfirmPassword, onToggleConfirmPassword, 'Show or hide confirm password')}
                </div>
              </label>

              <div className="settings-password-footer">
                <p className="settings-security-note">
                  At least 12 characters with uppercase, lowercase, number, and special character.
                </p>
                <button
                  type="submit"
                  className={`auth-btn settings-form__submit settings-form__submit--compact ${passwordSaving ? 'loading' : ''}`}
                  disabled={passwordSubmitDisabled}
                >
                  <span className="auth-btn__text">{passwordSubmitLabel}</span>
                  <span className="auth-btn__spinner"></span>
                </button>
              </div>
            </form>
          </section>

          <section className="settings-card settings-card--wide settings-card--session">
            <div className="settings-card__head">
              <div>
                <h2 className="settings-card__title">Session</h2>
                <p className="settings-card__copy">Sign out of this account when you are done.</p>
              </div>
              <button type="button" className="settings-logout-btn" onClick={onLogout}>
                Logout
              </button>
            </div>
          </section>
        </div>
      )}
    </section>
  );
}

export default function ProfileSettings() {
  const { user, refreshSession, logout } = useAuth();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const isDoctor = user?.role === 'doctor';

  const [loading, setLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [emailChangeRequesting, setEmailChangeRequesting] = useState(false);
  const [emailChangeConfirming, setEmailChangeConfirming] = useState(false);
  const [passwordSaving, setPasswordSaving] = useState(false);
  const [showEmailCurrentPassword, setShowEmailCurrentPassword] = useState(false);
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [profile, setProfile] = useState(null);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [profileForm, setProfileForm] = useState({ username: '', displayName: '' });
  const [emailChangeForm, setEmailChangeForm] = useState({
    newEmail: '',
    currentPassword: '',
    otp: '',
    pendingEmail: '',
  });
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: '',
  });

  useEffect(() => {
    let cancelled = false;

    setLoading(true);
    profileApi.getProfile()
      .then((response) => {
        if (cancelled) return;
        const nextProfile = response?.data ?? null;
        setProfile(nextProfile);
        setProfileForm({
          username: nextProfile?.username ?? '',
          displayName: nextProfile?.displayName ?? nextProfile?.username ?? '',
        });
      })
      .catch((error) => {
        if (cancelled) return;
        showToast(error.message || 'Failed to load profile settings', 'error');
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [showToast, user?.id]);

  const handleProfileFieldChange = (field, value) => {
    setProfileForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const handleEmailChangeFieldChange = (field, value) => {
    setEmailChangeForm((current) => ({
      ...current,
      [field]: field === 'otp' ? value.replace(/\D/g, '').slice(0, 6) : value,
    }));
  };

  const handlePasswordFieldChange = (field, value) => {
    setPasswordForm((current) => ({
      ...current,
      [field]: value,
    }));
  };

  const initialUsername = (profile?.username ?? '').trim();
  const initialDisplayName = (profile?.displayName ?? profile?.username ?? '').trim();
  const initialEmail = (profile?.email ?? '').trim().toLowerCase();
  const requestedEmail = emailChangeForm.newEmail.trim().toLowerCase();
  const isProfileDirty =
    profileForm.username.trim() !== initialUsername
    || profileForm.displayName.trim() !== initialDisplayName;
  const isPasswordDirty =
    passwordForm.currentPassword !== ''
    || passwordForm.newPassword !== ''
    || passwordForm.confirmPassword !== '';
  const canAttemptEmailRequest =
    Boolean(requestedEmail)
    && Boolean(emailChangeForm.currentPassword)
    && !emailChangeForm.pendingEmail;
  const canAttemptEmailConfirm = emailChangeForm.otp.trim().length === 6;
  const canAttemptPasswordSubmit =
    Boolean(passwordForm.currentPassword.trim())
    && Boolean(passwordForm.newPassword)
    && Boolean(passwordForm.confirmPassword);
  const canAttemptPasswordCreate =
    Boolean(passwordForm.newPassword)
    && Boolean(passwordForm.confirmPassword);

  const handleProfileSubmit = async (event) => {
    event.preventDefault();

    const username = profileForm.username.trim();
    const displayName = profileForm.displayName.trim();

    if (!isProfileDirty) {
      return;
    }

    if (!username || !displayName) {
      showToast('Display name and username are required.', 'error');
      return;
    }

    setProfileSaving(true);
    try {
      const response = await profileApi.updateProfile({ username, displayName });
      const nextProfile = response?.data ?? null;

      setProfile(nextProfile);
      setProfileForm({
        username: nextProfile?.username ?? username,
        displayName: nextProfile?.displayName ?? displayName,
      });

      await refreshSession().catch(() => null);
      showToast(response?.message || 'Profile updated successfully.');
    } catch (error) {
      showToast(error.message || 'Failed to update profile', 'error');
    } finally {
      setProfileSaving(false);
    }
  };

  const handleEmailChangeRequest = async (event) => {
    event.preventDefault();

    const newEmail = emailChangeForm.newEmail.trim().toLowerCase();

    const emailError = validateEmail(newEmail);
    if (emailError) {
      showToast(emailError, 'error');
      return;
    }

    if (newEmail === initialEmail) {
      showToast('New email must be different from your current email.', 'error');
      return;
    }

    if (!emailChangeForm.currentPassword) {
      showToast('Enter your current password.', 'error');
      return;
    }

    setEmailChangeRequesting(true);
    try {
      const response = await profileApi.requestEmailChange({
        newEmail,
        currentPassword: emailChangeForm.currentPassword,
      });
      const pendingEmail = response?.data?.pendingEmail ?? newEmail;

      setEmailChangeForm({
        newEmail: '',
        currentPassword: '',
        otp: '',
        pendingEmail,
      });
      showToast(response?.message || 'A verification code has been sent to your new email.');
    } catch (error) {
      showToast(error.message || 'Failed to send email change code', 'error');
    } finally {
      setShowEmailCurrentPassword(false);
      setEmailChangeForm((current) => ({
        ...current,
        currentPassword: '',
      }));
      setEmailChangeRequesting(false);
    }
  };

  const handleEmailChangeConfirm = async (event) => {
    event.preventDefault();

    if (emailChangeForm.otp.trim().length !== 6) {
      showToast('Enter the 6-digit verification code.', 'error');
      return;
    }

    setEmailChangeConfirming(true);
    try {
      const response = await profileApi.confirmEmailChange({
        otp: emailChangeForm.otp.trim(),
      });
      const nextProfile = response?.data ?? null;

      setProfile(nextProfile);
      setProfileForm({
        username: nextProfile?.username ?? profileForm.username,
        displayName: nextProfile?.displayName ?? nextProfile?.username ?? profileForm.displayName,
      });
      setEmailChangeForm({
        newEmail: '',
        currentPassword: '',
        otp: '',
        pendingEmail: '',
      });

      await refreshSession().catch(() => null);
      showToast(response?.message || 'Email updated successfully.');
    } catch (error) {
      showToast(error.message || 'Failed to confirm email change', 'error');
    } finally {
      setEmailChangeConfirming(false);
    }
  };

  const handleCancelEmailChange = () => {
    setShowEmailCurrentPassword(false);
    setEmailChangeForm({
      newEmail: '',
      currentPassword: '',
      otp: '',
      pendingEmail: '',
    });
  };

  const handleVerifyEmail = () => {
    navigate('/verify-email');
  };

  const handlePasswordSubmit = async (event) => {
    event.preventDefault();

    if (!isPasswordDirty || !canAttemptPasswordSubmit) {
      return;
    }

    if (!passwordForm.currentPassword || !passwordForm.newPassword || !passwordForm.confirmPassword) {
      showToast('Fill in all password fields.', 'error');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast('New passwords do not match.', 'error');
      return;
    }

    const passwordError = validatePassword(passwordForm.newPassword);
    if (passwordError) {
      showToast(passwordError, 'error');
      return;
    }

    setPasswordSaving(true);
    try {
      const response = await profileApi.changePassword({
        currentPassword: passwordForm.currentPassword,
        newPassword: passwordForm.newPassword,
      });

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });

      showToast(response?.message || 'Password updated successfully.');
    } catch (error) {
      showToast(error.message || 'Failed to update password', 'error');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleCreatePasswordSubmit = async (event) => {
    event.preventDefault();

    if (!passwordForm.newPassword || !passwordForm.confirmPassword) {
      showToast('Fill in both password fields.', 'error');
      return;
    }

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      showToast('Passwords do not match.', 'error');
      return;
    }

    const passwordError = validatePassword(passwordForm.newPassword);
    if (passwordError) {
      showToast(passwordError, 'error');
      return;
    }

    setPasswordSaving(true);
    try {
      const response = await profileApi.createPassword({
        newPassword: passwordForm.newPassword,
      });

      setPasswordForm({
        currentPassword: '',
        newPassword: '',
        confirmPassword: '',
      });

      // Refresh the profile so the card switches from "Create" to "Change" password.
      const refreshed = await profileApi.getProfile().catch(() => null);
      if (refreshed?.data) {
        setProfile(refreshed.data);
      }
      await refreshSession().catch(() => null);

      showToast(response?.message || 'Password created successfully.');
    } catch (error) {
      showToast(error.message || 'Failed to create password', 'error');
    } finally {
      setPasswordSaving(false);
    }
  };

  const handleLogout = () => {
    setShowLogoutConfirm(true);
  };

  const confirmLogout = () => {
    setShowLogoutConfirm(false);
    logout();
    navigate('/', { replace: true });
  };

  const content = (
    <SettingsContent
      user={user}
      profile={profile}
      loading={loading}
      profileForm={profileForm}
      emailChangeForm={emailChangeForm}
      passwordForm={passwordForm}
      isProfileDirty={isProfileDirty}
      isPasswordDirty={isPasswordDirty}
      canAttemptEmailRequest={canAttemptEmailRequest}
      canAttemptEmailConfirm={canAttemptEmailConfirm}
      canAttemptPasswordSubmit={canAttemptPasswordSubmit}
      canAttemptPasswordCreate={canAttemptPasswordCreate}
      showEmailCurrentPassword={showEmailCurrentPassword}
      showCurrentPassword={showCurrentPassword}
      showNewPassword={showNewPassword}
      showConfirmPassword={showConfirmPassword}
      profileSaving={profileSaving}
      emailChangeRequesting={emailChangeRequesting}
      emailChangeConfirming={emailChangeConfirming}
      passwordSaving={passwordSaving}
      onProfileFieldChange={handleProfileFieldChange}
      onEmailChangeFieldChange={handleEmailChangeFieldChange}
      onPasswordFieldChange={handlePasswordFieldChange}
      onToggleEmailCurrentPassword={() => setShowEmailCurrentPassword((value) => !value)}
      onToggleCurrentPassword={() => setShowCurrentPassword((value) => !value)}
      onToggleNewPassword={() => setShowNewPassword((value) => !value)}
      onToggleConfirmPassword={() => setShowConfirmPassword((value) => !value)}
      onProfileSubmit={handleProfileSubmit}
      onEmailChangeRequest={handleEmailChangeRequest}
      onEmailChangeConfirm={handleEmailChangeConfirm}
      onCancelEmailChange={handleCancelEmailChange}
      onVerifyEmail={handleVerifyEmail}
      onPasswordSubmit={handlePasswordSubmit}
      onCreatePasswordSubmit={handleCreatePasswordSubmit}
      onLogout={handleLogout}
    />
  );

  const logoutDialog = (
    <ConfirmDialog
      isOpen={showLogoutConfirm}
      title="Sign out of DoseFinder?"
      message="You will be returned to the home page and will need to sign in again to access your account."
      confirmLabel="Sign Out"
      variant="danger"
      onConfirm={confirmLogout}
      onCancel={() => setShowLogoutConfirm(false)}
    />
  );

  if (isDoctor) {
    return (
      <AppLayout>
        <main className="app-content settings-app-content">
          {content}
        </main>
        {logoutDialog}
      </AppLayout>
    );
  }

  return (
    <>
      <Navbar />
      <main className="settings-standalone">
        <div className="container">
          {content}
        </div>
      </main>
      {logoutDialog}
      <Footer />
    </>
  );
}
