import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { canManageIssues } from '../utils/doctorAccess';
import { getUserDisplayName, getUserInitials } from '../utils/userDisplay';

export default function AppSidebar({ isOpen, onNavigate }) {
  const location = useLocation();
  const { user } = useAuth();

  const isActive = (matcher) => {
    if (typeof matcher === 'function') {
      return matcher(location.pathname);
    }
    return location.pathname === matcher;
  };

  const showDashboardNav = user?.role === 'doctor';
  const showIssuesNav = canManageIssues(user);
  const displayName = getUserDisplayName(user, 'Doctor');
  const initials = getUserInitials(user, 'D');
  const showUnverifiedBadge = user?.role !== 'guest' && user?.emailVerified === false;

  return (
    <aside className={`app-sidebar ${isOpen ? 'app-sidebar--open' : ''}`} aria-label="Main navigation">
      <div className="app-sidebar__brand">
        <Link to="/" className="app-logo" aria-label="DoseFinder home">
          <span className="app-logo__text">Dose<span className="app-logo__accent">Finder</span></span>
        </Link>
      </div>

      <nav className="app-nav" aria-label="Sidebar navigation">
        <ul className="app-nav__list" role="list">
          {showDashboardNav && (
            <li>
              <Link
                to="/dashboard"
                className={`app-nav__link ${isActive('/dashboard') ? 'app-nav__link--active' : ''}`}
                aria-current={isActive('/dashboard') ? 'page' : undefined}
                onClick={onNavigate}
              >
                <span className="app-nav__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <rect x="3" y="3" width="7" height="7" rx="1" />
                    <rect x="14" y="3" width="7" height="7" rx="1" />
                    <rect x="3" y="14" width="7" height="7" rx="1" />
                    <rect x="14" y="14" width="7" height="7" rx="1" />
                  </svg>
                </span>
                <span className="app-nav__label">Dashboard</span>
              </Link>
            </li>
          )}

          <li>
            <Link
              to="/medications"
              className={`app-nav__link ${isActive((p) => p === '/medications' || p === '/add-drug' || p.startsWith('/edit-drug')) ? 'app-nav__link--active' : ''}`}
              aria-current={isActive((p) => p === '/medications' || p === '/add-drug' || p.startsWith('/edit-drug')) ? 'page' : undefined}
              onClick={onNavigate}
            >
              <span className="app-nav__icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
                  <path d="m8.5 8.5 7 7" />
                </svg>
              </span>
              <span className="app-nav__label">Medications</span>
            </Link>
          </li>

          {showIssuesNav && (
            <li>
              <Link
                to="/issues"
                className={`app-nav__link ${isActive((p) => p === '/issues' || p.startsWith('/issues/')) ? 'app-nav__link--active' : ''}`}
                aria-current={isActive((p) => p === '/issues' || p.startsWith('/issues/')) ? 'page' : undefined}
                onClick={onNavigate}
              >
                <span className="app-nav__icon" aria-hidden="true">
                  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </span>
                <span className="app-nav__label">Issues</span>
              </Link>
            </li>
          )}

          <li className="app-nav__divider" role="separator" />

          <li>
            <Link
              to="/chatbot"
              className={`app-nav__link ${isActive('/chatbot') ? 'app-nav__link--active' : ''}`}
              aria-current={isActive('/chatbot') ? 'page' : undefined}
              onClick={onNavigate}
            >
              <span className="app-nav__icon" aria-hidden="true">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M12 8V4H8" />
                  <rect width="16" height="12" x="4" y="8" rx="2" />
                  <path d="M2 14h2" />
                  <path d="M20 14h2" />
                  <path d="M15 13v2" />
                  <path d="M9 13v2" />
                </svg>
              </span>
              <span className="app-nav__label">DoseGPT</span>
            </Link>
          </li>

        </ul>
      </nav>

      <div className="app-sidebar__profile">
        <Link
          to="/saved"
          className={`app-nav__link app-sidebar__saved-link ${isActive('/saved') ? 'app-nav__link--active' : ''}`}
          aria-current={isActive('/saved') ? 'page' : undefined}
          onClick={onNavigate}
        >
          <span className="app-nav__icon" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
            </svg>
          </span>
          <span className="app-nav__label">My Saved</span>
        </Link>
        <div className="app-sidebar__profile-row">
          <Link to="/settings" className="app-sidebar__profile-link" onClick={onNavigate}>
            <span className="app-sidebar__avatar">
              <span className="app-sidebar__avatar-fallback">{initials}</span>
            </span>
            <div className="app-sidebar__profile-info">
              <span className="app-sidebar__profile-name">{displayName}</span>
              <span className="app-sidebar__profile-role">{user?.role === 'doctor' ? 'Doctor' : 'Admin'}</span>
            </div>
            <span className="app-sidebar__profile-chevron" aria-hidden="true">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="m9 18 6-6-6-6" />
              </svg>
            </span>
          </Link>
          {showUnverifiedBadge && (
            <Link to="/verify-email" className="app-sidebar__unverified-link" onClick={onNavigate}>
              Unverified
            </Link>
          )}
        </div>
      </div>
    </aside>
  );
}
