import { useMemo, useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import SearchHeader from '../components/SearchHeader';
import Footer from '../components/Footer';
import { useToast } from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { useSavedItems } from '../hooks/useSavedItems';
import { useAuth } from '../contexts/AuthContext';
import { getDosageFormIcon } from '../utils/getDosageFormIcon';
import '../styles/search-results.css';
import '../styles/saved-items.css';

const normalizeForCard = (item) => ({
  id: item.id,
  name: item.name || 'Unknown Drug',
  subtitle: item.subtitle || 'Medication details',
  desc: 'Full medication details available in the drug view page.',
  tags: item.category ? [item.category] : ['Medication'],
  rx: item.rx || 'Rx',
  price: item.price ?? 0,
  badge: 'related',
  gradient: 'linear-gradient(135deg, #eff6ff 0%, #f1f5f9 100%)',
  icon: getDosageFormIcon(item.dosage_form),
  route: item.route || `/drug/${item.id}`,
  clinicalBadges: [],
  savedAt: item.savedAt,
});

export default function SavedItems({ embedded = false }) {
  const { showToast } = useToast();
  const { isAuthenticated, loading: authLoading } = useAuth();
  const { savedItems, loading, removeItem, clearItems } = useSavedItems();
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [isClearingSaved, setIsClearingSaved] = useState(false);

  const savedCards = useMemo(
    () => savedItems.map(normalizeForCard),
    [savedItems],
  );
  const browseMedicationsPath = embedded ? '/medications' : '/search-results?q=amoxicillin';

  if (!authLoading && !isAuthenticated) {
    return <Navigate to="/" replace />;
  }

  const handleRemove = async (drug) => {
    try {
      await removeItem(drug.id);
      showToast('Removed from saved items');
    } catch (error) {
      showToast(error.message || 'Failed to remove saved item');
    }
  };

  const confirmClear = async () => {
    setIsClearingSaved(true);
    try {
      await clearItems();
      setShowClearConfirm(false);
      showToast('Saved items cleared');
    } catch (error) {
      showToast(error.message || 'Failed to clear saved items');
    } finally {
      setIsClearingSaved(false);
    }
  };

  const savedContent = (
    <main className={embedded ? 'app-content app-content--saved' : 'sr-main saved-main'}>
      <section className="sr-results-section">
        <div className="sr-results-header saved-results-header">
          <div>
            <h1 className="sr-results-title">{embedded ? 'My Saved' : 'Saved Items'}</h1>
            <div className="sr-results-count">
              {savedCards.length > 0
                ? `You saved ${savedCards.length} medication${savedCards.length > 1 ? 's' : ''}`
                : 'Your saved list is currently empty'}
            </div>
          </div>
          {savedCards.length > 0 && (
            <button type="button" className="sr-clear-filters-btn saved-clear-btn" onClick={() => setShowClearConfirm(true)}>
              Clear All
            </button>
          )}
        </div>

        {loading ? (
          <div className="sr-no-results saved-empty" style={{ display: 'block' }}>
            <div className="auth-btn__spinner" style={{ width: 32, height: 32, borderWidth: 3, margin: '0 auto' }}></div>
            <p>Loading your saved medications...</p>
          </div>
        ) : savedCards.length === 0 ? (
          <div className="sr-no-results saved-empty" style={{ display: 'block' }}>
            <svg width="64" height="64" fill="none" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.5" /><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="m16.5 16.5 3.5 3.5" /><path stroke="currentColor" strokeLinecap="round" strokeWidth="1.5" d="M8.5 11h5M11 8.5v5" /></svg>
            <h3>No saved items yet</h3>
            <p>Save medications from search results to keep them here with full details.</p>
            <Link to={browseMedicationsPath} className="sr-btn-view-primary saved-empty-btn">
              Browse Medications
            </Link>
          </div>
        ) : (
          <div className="sr-cards-list">
            {savedCards.map((d, i) => (
              <article key={d.id} className="sr-drug-card" style={{ animationDelay: `${i * 0.05}s` }}>
                  <div className="sr-card-desktop">
                    <div className="sr-card-img" style={{ backgroundImage: d.gradient }}>
                      {d.icon && <img src={d.icon} alt="" className="sr-drug-icon" />}
                    </div>
                    <div className="sr-card-body">
                      <div className="sr-card-top">
                        <div>
                          <div className="sr-card-title-row">
                            <span className="sr-card-title">{d.name}</span>
                            {d.badge === 'trusted' ? (
                              <span className="sr-badge sr-badge-trusted">
                                <svg width="12" height="12" fill="none" viewBox="0 0 24 24"><path stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" d="m5 13 4 4L19 7" /></svg>
                                Trusted Source
                              </span>
                            ) : (
                              <span className="sr-badge sr-badge-related">Saved</span>
                            )}
                          </div>
                          <div className="sr-card-subtitle">{d.subtitle}</div>
                          <p className="sr-card-desc">{d.desc}</p>
                          <div className="sr-tags">
                            {d.tags.map((t) => <span key={`${d.id}-${t}`} className="sr-tag">{t}</span>)}
                            <span className={`sr-tag ${d.rx === 'Rx' ? 'sr-tag-rx' : 'sr-tag-otc'}`}>
                              {d.rx === 'Rx' ? 'Rx Only' : 'OTC'}
                            </span>
                          </div>
                        </div>
                        <button
                          className="sr-save-btn saved"
                          onClick={() => handleRemove(d)}
                          title="Remove from saved"
                        >
                          <svg width="16" height="20" fill="currentColor" viewBox="0 0 24 24">
                            <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 3h14a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                          </svg>
                        </button>
                      </div>
                      <div className="sr-card-footer">
                        <div>
                          <div className="sr-card-price-label">Estimated Price</div>
                          <div className="sr-card-price">${d.price} <span>/ pack</span></div>
                        </div>
                        <Link to={d.route} className="sr-btn-view-primary">View Details</Link>
                      </div>
                    </div>
                  </div>

                  <div className="sr-card-mobile">
                    <div className="sr-card-mobile-header">
                      <h3 className="sr-card-mobile-title">{d.name}</h3>
                      <button className="sr-save-btn saved" onClick={() => handleRemove(d)} aria-label="Remove saved item">
                        <svg width="14" height="18" fill="currentColor" viewBox="0 0 24 24">
                          <path stroke="currentColor" strokeWidth="2" strokeLinecap="round" d="M5 3h14a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z" />
                        </svg>
                      </button>
                    </div>
                    {d.clinicalBadges && (
                      <div className="sr-clinical-badges">
                        {d.clinicalBadges.includes('fda') && (
                          <span className="sr-clinical-badge sr-badge-fda">FDA Approved</span>
                        )}
                        {d.clinicalBadges.includes('clinical') && (
                          <span className="sr-clinical-badge sr-badge-clinical">Clinical Key</span>
                        )}
                        {d.clinicalBadges.includes('peer') && (
                          <span className="sr-clinical-badge sr-badge-peer">Peer Reviewed</span>
                        )}
                        {d.clinicalBadges.includes('boxed') && (
                          <span className="sr-clinical-badge sr-badge-boxed">Boxed Warning</span>
                        )}
                      </div>
                    )}
                    {d.clinical && (
                      <div className="sr-clinical-section">
                        <div className="sr-clinical-label">Clinical Guidelines</div>
                        <p className="sr-clinical-text">{d.clinical}</p>
                      </div>
                    )}
                    {d.adultDosage && (
                      <div className="sr-dosage-grid">
                        <div>
                          <div className="sr-dosage-label">Adult Dosage</div>
                          <div className="sr-dosage-value">{d.adultDosage}</div>
                        </div>
                        <div>
                          <div className="sr-dosage-label">Pediatric</div>
                          <div className="sr-dosage-value">{d.pediatricDosage}</div>
                        </div>
                      </div>
                    )}
                    <div className="sr-card-mobile-footer">
                      <div>
                        <div className="sr-card-price-label">Estimated Price</div>
                        <div className="sr-card-price">${d.price} <span>/ pack</span></div>
                      </div>
                      <Link to={d.route} className="sr-btn-view-primary sr-btn-mobile">View Details</Link>
                    </div>
                  </div>
              </article>
            ))}
          </div>
        )}
      </section>
      <ConfirmDialog
        isOpen={showClearConfirm}
        title="Clear saved medications?"
        message={`This will remove ${savedCards.length} saved medication${savedCards.length === 1 ? '' : 's'} from your list. This action cannot be undone.`}
        confirmLabel="Clear All"
        variant="danger"
        isBusy={isClearingSaved}
        onConfirm={confirmClear}
        onCancel={() => setShowClearConfirm(false)}
      />
    </main>
  );

  if (embedded) {
    return savedContent;
  }

  return (
    <div className="search-results-page">
      <SearchHeader />

      <div className="sr-breadcrumb">
        <div className="sr-breadcrumb-inner">
          <Link to="/">Home</Link>
          <span className="sep">›</span>
          <span className="current">Saved Items</span>
        </div>
      </div>

      {savedContent}
      <Footer />
    </div>
  );
}

