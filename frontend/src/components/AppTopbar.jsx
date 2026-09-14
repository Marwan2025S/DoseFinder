import { Link } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getUserDisplayName, getUserInitials } from '../utils/userDisplay';

export default function AppTopbar({
  onToggleSidebar,
  onToggleAI,
  isAIOpen,
  onSearchChange,
  searchQuery = '',
}) {
  const { user } = useAuth();
  const displayName = getUserDisplayName(user);
  const initials = getUserInitials(user);

  return (
    <header className="app-topbar">
      <div className="app-topbar__brand-row">
        <button
          className="app-topbar__menu-btn"
          type="button"
          aria-label="Toggle navigation"
          onClick={onToggleSidebar}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>

        <Link to="/" className="app-topbar__logo" aria-label="DoseFinder home">
          Dose<span>Finder</span>
        </Link>
      </div>

      {onSearchChange ? (
        <div className="app-topbar__search-wrap" role="search">
          <span className="app-topbar__search-icon" aria-hidden="true">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="8" />
              <path d="m21 21-4.35-4.35" />
            </svg>
          </span>
          <input
            type="search"
            className="app-topbar__search-input"
            placeholder="Search medications or notes..."
            aria-label="Global search"
            autoComplete="off"
            value={searchQuery}
            onChange={(event) => onSearchChange(event.target.value)}
          />
        </div>
      ) : null}

      <div className="app-topbar__actions">
        <button
          className={`app-topbar__nav-link ${isAIOpen ? 'app-topbar__nav-link--active' : ''}`}
          type="button"
          aria-label="Open DoseGPT assistant"
          aria-expanded={isAIOpen}
          onClick={onToggleAI}
        >
          DoseGPT
        </button>

        <Link to="/saved" className="app-topbar__saved-link" aria-label="Open saved drugs">
          <span>My Saved</span>
        </Link>

        <Link to="/settings" className="app-topbar__profile-link" aria-label="Open profile settings">
          <span className="app-topbar__profile-avatar" aria-hidden="true">{initials}</span>
          <span className="app-topbar__profile-name">{displayName}</span>
        </Link>
      </div>
    </header>
  );
}
