import { useState, useRef, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import ConfirmDialog from './ConfirmDialog';
import '../styles/avatar-dropdown.css';

export default function AvatarDropdown({
  displayName,
  initials,
  emailVerified = true,
  showProfileLink = true,
  showUserHeader = true,
  showSignOut = true,
  triggerLabel = '',
  triggerTo = '',
  showUnverifiedBadge = true,
}) {
  const [open, setOpen] = useState(false);
  const [showSignOutConfirm, setShowSignOutConfirm] = useState(false);
  const menuRef = useRef(null);
  const buttonRef = useRef(null);
  const { logout } = useAuth();
  const navigate = useNavigate();
  const shouldShowUnverifiedBadge = showUnverifiedBadge && emailVerified === false;

  useEffect(() => {
    if (!open) return;
    const handleClickOutside = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target) &&
          buttonRef.current && !buttonRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    const handleEscape = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handleScroll = () => setOpen(false);
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [open]);

  const handleSignOut = (e) => {
    e.preventDefault();
    setOpen(false);
    setShowSignOutConfirm(true);
  };

  const confirmSignOut = () => {
    setShowSignOutConfirm(false);
    logout();
    navigate('/', { replace: true });
  };

  return (
    <div className="avatar-dropdown">
      <div className="avatar-dropdown__cluster">
        {shouldShowUnverifiedBadge && (
          <Link
            to="/verify-email"
            className="avatar-dropdown__unverified"
            aria-label="Verify your email"
            onClick={() => setOpen(false)}
          >
            Unverified
          </Link>
        )}
        {triggerLabel && triggerTo ? (
          <span className="avatar-dropdown__split-trigger">
            <Link to={triggerTo} className="avatar-dropdown__trigger-link">
              {triggerLabel}
            </Link>
            <button
              ref={buttonRef}
              type="button"
              className="avatar-dropdown__trigger-menu"
              onClick={() => setOpen((prev) => !prev)}
              aria-haspopup="true"
              aria-expanded={open}
              aria-label="Open guest menu"
            >
              <svg className="avatar-dropdown__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
          </span>
        ) : (
          <button
            ref={buttonRef}
            type="button"
            className={`avatar-dropdown__trigger ${triggerLabel ? 'avatar-dropdown__trigger--label' : ''}`}
            onClick={() => setOpen((prev) => !prev)}
            aria-haspopup="true"
            aria-expanded={open}
            aria-label="User menu"
          >
            {triggerLabel ? (
              <span className="avatar-dropdown__trigger-label">{triggerLabel}</span>
            ) : (
            <span className="avatar-dropdown__avatar">{initials}</span>
            )}
            <svg className="avatar-dropdown__chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="m6 9 6 6 6-6" />
            </svg>
          </button>
        )}
      </div>

      <div
        ref={menuRef}
        className={`avatar-dropdown__menu ${open ? 'avatar-dropdown__menu--open' : ''}`}
        role="menu"
        aria-label="User menu"
      >
        {showUserHeader && (
          <>
            <div className="avatar-dropdown__user">
              <span className="avatar-dropdown__user-avatar">{initials}</span>
              <span className="avatar-dropdown__user-name">{displayName}</span>
            </div>
            <div className="avatar-dropdown__divider" />
          </>
        )}
        {showProfileLink && (
          <Link to="/settings" className="avatar-dropdown__item" role="menuitem" onClick={() => setOpen(false)}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
              <circle cx="12" cy="7" r="4" />
            </svg>
            <span>Profile</span>
          </Link>
        )}
        <Link to="/saved" className="avatar-dropdown__item" role="menuitem" onClick={() => setOpen(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
          </svg>
          <span>My Saved</span>
        </Link>
        <Link to="/chatbot" className="avatar-dropdown__item" role="menuitem" onClick={() => setOpen(false)}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 8V4H8" />
            <rect width="16" height="12" x="4" y="8" rx="2" />
            <path d="M2 14h2" />
            <path d="M20 14h2" />
            <path d="M15 13v2" />
            <path d="M9 13v2" />
          </svg>
          <span>DoseGPT</span>
        </Link>
        {showSignOut && (
          <>
            <div className="avatar-dropdown__divider" />
            <button className="avatar-dropdown__item avatar-dropdown__item--signout" role="menuitem" onClick={handleSignOut}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" y1="12" x2="9" y2="12" />
              </svg>
              <span>Sign Out</span>
            </button>
          </>
        )}
      </div>

      <ConfirmDialog
        isOpen={showSignOutConfirm}
        title="Sign out of DoseFinder?"
        message="You will be returned to the home page and will need to sign in again to access your account."
        confirmLabel="Sign Out"
        variant="danger"
        onConfirm={confirmSignOut}
        onCancel={() => setShowSignOutConfirm(false)}
      />
    </div>
  );
}
