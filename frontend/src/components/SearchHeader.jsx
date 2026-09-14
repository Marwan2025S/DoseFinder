import { Link, useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { getUserDisplayName, getUserInitials } from '../utils/userDisplay';
import { buildSearchPath } from '../utils/searchPath';
import AvatarDropdown from './AvatarDropdown';
import '../styles/search-header.css';

export default function SearchHeader({ initialSearchQuery = '' }) {
  const navigate = useNavigate();
  const { user, isAuthenticated } = useAuth();
  const [query, setQuery] = useState(initialSearchQuery);
  const hasUserSession = isAuthenticated && Boolean(user);
  const isGuestSession = user?.role === 'guest';
  const canShowProfileLink = user?.role !== 'guest';

  useEffect(() => {
    setQuery(initialSearchQuery);
  }, [initialSearchQuery]);

  const handleSearch = () => {
    const trimmed = query.trim();
    if (!trimmed) return;
    navigate(buildSearchPath(user, trimmed));
  };

  const displayName = user?.role === 'guest' ? 'Guest' : getUserDisplayName(user, 'Profile');
  const initials = user?.role === 'guest' ? 'G' : getUserInitials(user, 'P');

  return (
    <header className="search-header">
      <div className="header-inner">
        <Link to="/" className="logo">
          Dose<span>Finder</span>
        </Link>
        <div className="search-wrap">
          <div className="search-box">
            <div className="search-icon">
              <svg width="18" height="18" fill="none" viewBox="0 0 24 24">
                <circle cx="11" cy="11" r="7" stroke="#94a3b8" strokeWidth="2" />
                <path stroke="#94a3b8" strokeLinecap="round" strokeWidth="2" d="m16.5 16.5 3.5 3.5" />
              </svg>
            </div>
            <input
              type="text"
              className="search-input"
              placeholder="Search medications…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            />
            <button className="search-btn" onClick={handleSearch}>Search</button>
          </div>
        </div>
        <div className="header-actions">
          {hasUserSession ? (
            <AvatarDropdown
              displayName={displayName}
              initials={initials}
              emailVerified={user?.emailVerified}
              showProfileLink={canShowProfileLink}
              showUserHeader={!isGuestSession}
              showSignOut={!isGuestSession}
              triggerLabel={isGuestSession ? 'Login' : ''}
              triggerTo={isGuestSession ? '/login' : ''}
              showUnverifiedBadge={!isGuestSession}
            />
          ) : (
            <Link to="/login" className="btn-login btn-login--ghost">Login</Link>
          )}
        </div>
      </div>
    </header>
  );
}
