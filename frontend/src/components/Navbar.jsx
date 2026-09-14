import { useState, useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import { getUserDisplayName, getUserInitials } from '../utils/userDisplay';
import AvatarDropdown from './AvatarDropdown';

const smoothScrollToSection = (sectionId) => {
  const element = document.getElementById(sectionId);
  if (element) {
    const offset = 80;
    const elementPosition = element.getBoundingClientRect().top;
    const offsetPosition = elementPosition + window.pageYOffset - offset;
    window.scrollTo({
      top: offsetPosition,
      behavior: 'smooth'
    });
  }
};

export default function Navbar() {
  const location = useLocation();
  const { user, isAuthenticated } = useAuth();
  const hasUserSession = isAuthenticated && Boolean(user);
  const isGuestSession = user?.role === 'guest';
  const canShowProfileLink = user?.role !== 'guest';
  const displayName = user?.role === 'guest' ? 'Guest' : getUserDisplayName(user, 'Profile');
  const initials = user?.role === 'guest' ? 'G' : getUserInitials(user, 'P');
  const [menuOpen, setMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const [activeSection, setActiveSection] = useState('home');
  const isHomePage = location.pathname === '/';

  useEffect(() => {
    const onScroll = () => {
      setScrolled(window.scrollY > 10);
      if (isHomePage) {
        const sections = ['home', 'services', 'faq', 'contact'];
        const scrollPosition = window.scrollY + 100;

        for (const section of sections) {
          const element = document.getElementById(section);
          if (element) {
            const sectionTop = element.offsetTop;
            const sectionHeight = element.offsetHeight;
            if (scrollPosition >= sectionTop && scrollPosition < sectionTop + sectionHeight) {
              setActiveSection(section);
              break;
            }
          }
        }
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    onScroll();
    return () => window.removeEventListener('scroll', onScroll);
  }, [isHomePage]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => setMenuOpen(false));
    return () => window.cancelAnimationFrame(frame);
  }, [location.pathname]);

  return (
    <header className={`navbar ${scrolled ? 'scrolled' : ''}`} id="navbar">
      <div className="container nav-inner">
        <Link to="/" className="nav-logo">
          Dose<span>Finder</span>
        </Link>

        <nav className={`nav-links ${menuOpen ? 'open' : ''}`} id="navLinks">
          {isHomePage && (
            <>
              <button
                className={`nav-link ${activeSection === 'home' ? 'active' : ''}`}
                onClick={() => {
                  smoothScrollToSection('home');
                  setMenuOpen(false);
                }}
              >
                Home
              </button>
              <button
                className={`nav-link ${activeSection === 'services' ? 'active' : ''}`}
                onClick={() => {
                  smoothScrollToSection('services');
                  setMenuOpen(false);
                }}
              >
                Features
              </button>
              <button
                className={`nav-link ${activeSection === 'faq' ? 'active' : ''}`}
                onClick={() => {
                  smoothScrollToSection('faq');
                  setMenuOpen(false);
                }}
              >
                FAQ
              </button>
            </>
          )}
          {!hasUserSession && (
            <Link
              to="/login"
              className={`nav-link nav-profile-mobile ${location.pathname === '/login' ? 'active' : ''}`}
              onClick={() => setMenuOpen(false)}
            >
              Login
            </Link>
          )}
        </nav>

        <div className="nav-cta">
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
          <button
            className={`hamburger ${menuOpen ? 'open' : ''}`}
            id="hamburger"
            aria-label="Menu"
            onClick={() => setMenuOpen((prev) => !prev)}
          >
            <span></span><span></span><span></span>
          </button>
        </div>
      </div>
    </header>
  );
}
