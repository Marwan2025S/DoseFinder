import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppSidebar from './AppSidebar';
import { useAuth } from '../contexts/AuthContext';
import { buildSearchPath } from '../utils/searchPath';

export default function AppLayout({ children, onSearchChange, searchQuery = '', globalSearch = false }) {
  const [showSidebar, setShowSidebar] = useState(false);
  const [globalQuery, setGlobalQuery] = useState('');
  const navigate = useNavigate();
  const { user } = useAuth();
  const hasSearch = typeof onSearchChange === 'function';

  const submitGlobalSearch = () => {
    const trimmed = globalQuery.trim();
    if (!trimmed) return;
    navigate(buildSearchPath(user, trimmed));
  };

  const closePanels = () => {
    setShowSidebar(false);
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setShowSidebar(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const handleToggleSidebar = () => {
    setShowSidebar((prev) => !prev);
  };

  return (
    <div className="app-body">
      <div className="app-shell">
        <AppSidebar isOpen={showSidebar} onNavigate={() => setShowSidebar(false)} />
        <div className="app-main">
          <div className="app-page-toolbar">
            <button
              className="app-page-toolbar__menu-btn"
              type="button"
              aria-label="Toggle doctor navigation"
              onClick={handleToggleSidebar}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                <line x1="3" y1="6" x2="21" y2="6" />
                <line x1="3" y1="12" x2="21" y2="12" />
                <line x1="3" y1="18" x2="21" y2="18" />
              </svg>
            </button>

            {hasSearch ? (
              <div className="app-page-toolbar__search-wrap" role="search">
                <span className="app-page-toolbar__search-icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  type="search"
                  className="app-page-toolbar__search-input"
                  placeholder="Search medications or notes..."
                  aria-label="Search this workspace"
                  autoComplete="off"
                  value={searchQuery}
                  onChange={(event) => onSearchChange(event.target.value)}
                />
              </div>
            ) : globalSearch ? (
              <div className="app-page-toolbar__search-wrap" role="search">
                <span className="app-page-toolbar__search-icon" aria-hidden="true">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" />
                    <path d="m21 21-4.35-4.35" />
                  </svg>
                </span>
                <input
                  type="search"
                  className="app-page-toolbar__search-input"
                  placeholder="Search medications..."
                  aria-label="Search medications"
                  autoComplete="off"
                  value={globalQuery}
                  onChange={(event) => setGlobalQuery(event.target.value)}
                  onKeyDown={(event) => event.key === 'Enter' && submitGlobalSearch()}
                />
              </div>
            ) : null}
          </div>
          {children}
        </div>
      </div>
      <button
        type="button"
        className={`app-overlay ${showSidebar ? 'app-overlay--visible' : ''}`}
        aria-label="Close panels"
        onClick={closePanels}
      ></button>
    </div>
  );
}
