import { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { ToastProvider, useToast } from './components/Toast';
import AppLayout from './components/AppLayout';
import GoogleOneTap from './components/GoogleOneTap';
import { useAuth } from './contexts/AuthContext';
import { canManageDrugCatalog, canManageIssues } from './utils/doctorAccess';

import Home from './pages/Home';
import Login from './pages/Login';
import Register from './pages/Register';
import Dashboard from './pages/Dashboard';
import Issues from './pages/Issues';
import Medications from './pages/Medications';
import AddDrug from './pages/AddDrug';
import EditDrug from './pages/EditDrug';
import Chatbot from './pages/Chatbot';
import SharedChat from './pages/SharedChat';
import SearchResults from './pages/SearchResults';
import DrugView from './pages/DrugView';
import SavedItems from './pages/SavedItems';
import NotFound from './pages/NotFound';
import VerifyEmail from './pages/VerifyEmail';
import ForgotPassword from './pages/ForgotPassword';
import ProfileSettings from './pages/ProfileSettings';
import About from './pages/About';
import Contact from './pages/Contact';
import Support from './pages/Support';

function getPostAuthPath(user) {
  return user?.role === 'doctor' ? '/dashboard' : '/';
}

function DoseFinderMark({ className = '' }) {
  return (
    <svg className={className} width="52" height="52" viewBox="0 0 40 40" fill="none" aria-hidden="true">
      <rect x="0" y="0" width="16" height="16" rx="3" fill="currentColor" />
      <rect x="20" y="0" width="20" height="8" rx="3" fill="currentColor" />
      <rect x="20" y="12" width="20" height="8" rx="3" fill="currentColor" />
      <rect x="0" y="20" width="16" height="8" rx="3" fill="currentColor" />
      <rect x="0" y="32" width="16" height="8" rx="3" fill="currentColor" />
      <rect x="20" y="24" width="20" height="16" rx="3" fill="currentColor" />
    </svg>
  );
}

function FullPageSpinner() {
  return (
    <div className="app-loading-screen" role="status" aria-live="polite" aria-busy="true">
      <div className="app-loading-screen__content">
        <div className="app-loading-screen__brand" aria-label="Loading DoseFinder">
          <span className="app-loading-screen__mark">
            <DoseFinderMark className="app-loading-screen__mark-icon" />
          </span>
          <span className="app-loading-screen__wordmark">
            Dose<span>Finder</span>
          </span>
        </div>
        <div className="app-loading-screen__track" aria-hidden="true">
          <span></span>
        </div>
        <p className="app-loading-screen__text">Preparing your medication workspace...</p>
      </div>
    </div>
  );
}

function useVerificationRefresh(user, enabled) {
  const { refreshSession, refreshingSession } = useAuth();
  const [hasChecked, setHasChecked] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setHasChecked(false);
      return undefined;
    }

    let cancelled = false;
    setHasChecked(false);

    refreshSession()
      .catch(() => null)
      .finally(() => {
        if (!cancelled) {
          setHasChecked(true);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [enabled, refreshSession, user?.id]);

  return enabled && (!hasChecked || refreshingSession);
}

function ProtectedRoute({ children }) {
  const { isAuthenticated, loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isLoggingOut) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  if (user?.role === 'guest') {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function ProfileRoute({ children }) {
  const { isAuthenticated, loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isLoggingOut) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated || user?.role === 'guest') {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function LogoutRedirect() {
  const navigate = useNavigate();

  useEffect(() => {
    const redirectHome = () => navigate('/', { replace: true });
    window.addEventListener('dms:logout', redirectHome);
    return () => window.removeEventListener('dms:logout', redirectHome);
  }, [navigate]);

  return null;
}

function DashboardRoute({ children }) {
  const { isAuthenticated, loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isLoggingOut) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated || user?.role === 'guest') {
    return <Navigate to="/login" replace />;
  }

  if (user?.role !== 'doctor') {
    return (
      <RedirectWithToast
        to={getPostAuthPath(user)}
        message="Dashboard is only available to doctor accounts."
      />
    );
  }

  return children;
}

function ChatRoute({ children }) {
  const { isAuthenticated, loading, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isLoggingOut) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function HomeRoute() {
  const { loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (!isLoggingOut && user?.role === 'doctor') {
    return <Navigate to="/dashboard" replace />;
  }

  return <Home />;
}

// Role-aware search page: doctors get the doctor Medications search,
// everyone else (users, guests, logged-out) keeps the public results page.
function SearchRoute() {
  const { loading, user } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  return user?.role === 'doctor' ? <Medications /> : <SearchResults />;
}

function RedirectWithToast({ to, message }) {
  const { showToast } = useToast();

  useEffect(() => {
    if (message) {
      showToast(message, 'info');
    }
  }, [message, showToast]);

  return <Navigate to={to} replace />;
}

function DoctorWriteRoute({ children }) {
  const { isAuthenticated, loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isLoggingOut) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated || user?.role === 'guest') {
    return <Navigate to="/login" replace />;
  }

  if (!canManageDrugCatalog(user)) {
    return (
      <RedirectWithToast
        to={getPostAuthPath(user)}
        message={
          user?.role === 'doctor'
            ? 'Your doctor account is pending approval. Drug changes are disabled for now.'
            : 'Only admins and approved doctor accounts can modify drug data.'
        }
      />
    );
  }

  return children;
}

function DoctorIssuesRoute({ children }) {
  const { isAuthenticated, loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isLoggingOut) {
    return <Navigate to="/" replace />;
  }

  if (!isAuthenticated || user?.role === 'guest') {
    return <Navigate to="/login" replace />;
  }

  if (!canManageIssues(user)) {
    return (
      <RedirectWithToast
        to={getPostAuthPath(user)}
        message={
          user?.role === 'doctor'
            ? 'Your doctor account is pending approval. Issue management is disabled for now.'
            : 'Only approved doctors can manage user-reported issues.'
        }
      />
    );
  }

  return children;
}

function AuthRoute({ children }) {
  const { isAuthenticated, loading, user } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (isAuthenticated) {
    if (user?.role === 'guest') {
      return children;
    }

    return <Navigate to={getPostAuthPath(user)} replace />;
  }

  return children;
}

function VerificationRoute({ children }) {
  const { isAuthenticated, loading, pendingVerification, user } = useAuth();
  const checkingVerification = useVerificationRefresh(
    user,
    !loading && isAuthenticated && user?.role !== 'guest' && user && !user.emailVerified
  );

  if (loading || checkingVerification) {
    return <FullPageSpinner />;
  }

  if (user?.role === 'guest') {
    return <Navigate to="/" replace />;
  }

  if (user?.emailVerified) {
    return <Navigate to={getPostAuthPath(user)} replace />;
  }

  if (!isAuthenticated && !pendingVerification?.email) {
    return <Navigate to="/login" replace />;
  }

  return children;
}

function ChatbotRoute() {
  const location = useLocation();
  const { state, key } = location;
  return (
    <Chatbot
      drugId={state?.drugId}
      drugData={state?.drugData}
      initialPrompt={state?.initialPrompt}
      initialPromptKey={key}
    />
  );
}

function SavedRoute() {
  const { loading, user, isLoggingOut } = useAuth();

  if (loading) {
    return <FullPageSpinner />;
  }

  if (!isLoggingOut && user?.role === 'doctor') {
    return (
      <AppLayout>
        <SavedItems embedded />
      </AppLayout>
    );
  }

  return <SavedItems />;
}

function App() {
  return (
    <ToastProvider>
      <BrowserRouter>
        <LogoutRedirect />
        <GoogleOneTap />
        <Routes>
          <Route path="/" element={<HomeRoute />} />
          <Route path="/index" element={<HomeRoute />} />
          <Route path="/login" element={<AuthRoute><Login /></AuthRoute>} />
          <Route path="/register" element={<AuthRoute><Register /></AuthRoute>} />
          <Route path="/request-account" element={<AuthRoute><Register accountType="doctor" /></AuthRoute>} />
          <Route path="/forgot-password" element={<AuthRoute><ForgotPassword /></AuthRoute>} />
          <Route path="/verify-email" element={<VerificationRoute><VerifyEmail /></VerificationRoute>} />
          <Route path="/dashboard" element={<DashboardRoute><Dashboard /></DashboardRoute>} />
          <Route path="/settings" element={<ProfileRoute><ProfileSettings /></ProfileRoute>} />
          <Route path="/profile" element={<ProfileRoute><ProfileSettings /></ProfileRoute>} />
          <Route path="/issues" element={<DoctorIssuesRoute><Issues /></DoctorIssuesRoute>} />
          <Route path="/issues/:issueId" element={<DoctorIssuesRoute><Issues /></DoctorIssuesRoute>} />
          <Route path="/medications" element={<ProtectedRoute><Medications /></ProtectedRoute>} />
          <Route path="/add-drug" element={<DoctorWriteRoute><AddDrug /></DoctorWriteRoute>} />
          <Route path="/edit-drug" element={<DoctorWriteRoute><EditDrug /></DoctorWriteRoute>} />
          <Route path="/edit-drug/:id" element={<DoctorWriteRoute><EditDrug /></DoctorWriteRoute>} />
          <Route path="/chat/share/:token" element={<SharedChat />} />
          <Route path="/chatbot" element={<ChatRoute><ChatbotRoute /></ChatRoute>} />
          <Route path="/search" element={<SearchRoute />} />
          <Route path="/search-results" element={<SearchResults />} />
          <Route path="/saved" element={<SavedRoute />} />
          <Route path="/drug/:id" element={<DrugView />} />
          <Route path="/view/:id" element={<DrugView />} />
          <Route path="/about" element={<About />} />
          <Route path="/contact" element={<Contact />} />
          <Route path="/support" element={<Support />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </ToastProvider>
  );
}

export default App;
