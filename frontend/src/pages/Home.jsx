import Navbar from '../components/Navbar';
import Footer from '../components/Footer';
import { useNavigate } from 'react-router-dom';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useToast } from '../components/Toast';
import { useAuth } from '../contexts/AuthContext';
import { profileApi } from '../services/api';
import mainIllustration from '../assets/image.svg';

export default function Home() {
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user, isAuthenticated } = useAuth();
  const [query, setQuery] = useState('');
  const [openFaq, setOpenFaq] = useState(null);
  const [activeSuggestionIndex, setActiveSuggestionIndex] = useState(-1);
  const [isSuggestionOpen, setIsSuggestionOpen] = useState(false);
  const [searchHistory, setSearchHistory] = useState([]);
  const [removingHistoryId, setRemovingHistoryId] = useState(null);
  const searchWrapRef = useRef(null);
  const pageRef = useRef(null);
  const canLoadSearchHistory = isAuthenticated;

  const suggestionItems = useMemo(() => {
    const historyItems = Array.from(
      new Map(
        searchHistory
          .map((item) => {
            const term = item?.search_term?.trim();
            if (!term) return null;
            return { id: item.id, term };
          })
          .filter(Boolean)
          .map((item) => [item.term.toLowerCase(), item]),
      ).values(),
    );
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) return historyItems.slice(0, 5);
    return historyItems
      .filter((item) => item.term.toLowerCase().includes(trimmed))
      .slice(0, 5);
  }, [query, searchHistory]);

  const fetchSearchHistory = useCallback(async () => {
    if (!canLoadSearchHistory) {
      setSearchHistory([]);
      return;
    }

    try {
      const res = await profileApi.getSearchHistory(5);
      setSearchHistory(Array.isArray(res?.data) ? res.data : []);
    } catch {
      setSearchHistory([]);
    }
  }, [canLoadSearchHistory]);

  const goToResults = (value) => {
    const text = value.trim();
    if (!text) return;
    setIsSuggestionOpen(false);
    setActiveSuggestionIndex(-1);
    navigate(`/search-results?q=${encodeURIComponent(text)}`);
  };

  const handleSearch = () => {
    goToResults(query);
  };

  const handleAskAI = () => {
    const text = query.trim();
    setIsSuggestionOpen(false);
    setActiveSuggestionIndex(-1);
    navigate('/chatbot', {
      state: text ? { initialPrompt: text } : undefined,
    });
  };

  const handleRemoveHistoryItem = async (item) => {
    if (!item?.id) return;

    try {
      setRemovingHistoryId(item.id);
      await profileApi.removeSearchHistoryItem(item.id);
      await fetchSearchHistory();
      setActiveSuggestionIndex(-1);
    } catch (error) {
      showToast(error.message || 'Failed to remove search history item', 'error');
    } finally {
      setRemovingHistoryId(null);
    }
  };

  const toggleFaq = (index) => {
    if (openFaq === index) {
      setOpenFaq(null);
    } else {
      setOpenFaq(index);
    }
  };

  useEffect(() => {
    const onClickOutside = (event) => {
      if (!searchWrapRef.current?.contains(event.target)) {
        setIsSuggestionOpen(false);
        setActiveSuggestionIndex(-1);
      }
    };
    document.addEventListener('click', onClickOutside);
    return () => document.removeEventListener('click', onClickOutside);
  }, []);

  useEffect(() => {
    let cancelled = false;

    if (!canLoadSearchHistory) {
      setSearchHistory([]);
      return undefined;
    }

    profileApi.getSearchHistory(5)
      .then((res) => {
        if (cancelled) return;
        setSearchHistory(Array.isArray(res?.data) ? res.data : []);
      })
      .catch(() => {
        if (cancelled) return;
        setSearchHistory([]);
      });

    return () => {
      cancelled = true;
    };
  }, [canLoadSearchHistory]);

  useEffect(() => {
    const root = pageRef.current;
    if (!root) return undefined;

    const items = root.querySelectorAll('.reveal, .reveal-left, .reveal-up');
    if (items.length === 0) return undefined;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reducedMotion) {
      items.forEach((item) => item.classList.add('revealed'));
      return undefined;
    }

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add('revealed');
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.16, rootMargin: '0px 0px -12% 0px' },
    );

    items.forEach((item) => observer.observe(item));
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <Navbar />
      <main ref={pageRef}>
        {/* HERO */}
        <section className="hero" id="home">
          <div className="hero-bg" aria-hidden="true"></div>
          <div className="hero-dots" aria-hidden="true"></div>

          <div className="blob blob-1" aria-hidden="true"></div>
          <div className="blob blob-2" aria-hidden="true"></div>
          <div className="blob blob-3" aria-hidden="true"></div>

          <div className="deco deco-1" aria-hidden="true">
            <svg width="44" height="28" viewBox="0 0 44 28" fill="none">
              <rect x="1.25" y="1.25" width="41.5" height="25.5" rx="12.75" stroke="#5B9CF6" strokeWidth="2.5" opacity=".4" />
            </svg>
          </div>
          <div className="deco deco-2" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
              <circle cx="17" cy="17" r="9" fill="#FF8E72" opacity=".35" />
            </svg>
          </div>
          <div className="deco deco-3" aria-hidden="true">
            <svg width="30" height="30" viewBox="0 0 30 30" fill="none">
              <path d="M15 25S5 18.8 5 12.2C5 9.5 7.1 7.4 9.8 7.4c1.5 0 2.7.7 3.6 1.8l1.6 2.1 1.6-2.1c.9-1.1 2.1-1.8 3.6-1.8 2.7 0 4.8 2.1 4.8 4.8 0 6.6-10 12.8-10 12.8z" fill="#F66DA6" opacity=".26" />
            </svg>
          </div>
          <div className="deco deco-4" aria-hidden="true">
            <svg width="34" height="34" viewBox="0 0 34 34" fill="none">
              <rect x="14" y="4" width="6" height="26" rx="3" fill="#5B9CF6" opacity=".35" />
              <rect x="4" y="14" width="26" height="6" rx="3" fill="#5B9CF6" opacity=".35" />
            </svg>
          </div>
          <div className="deco deco-5" aria-hidden="true">
            <svg width="58" height="24" viewBox="0 0 58 24" fill="none">
              <rect x="1.25" y="1.25" width="55.5" height="21.5" rx="10.75" fill="rgba(19,182,236,.15)" stroke="#13b6ec" strokeWidth="2.5" />
              <path d="M29 3v18" stroke="#13b6ec" strokeWidth="2" opacity=".45" />
            </svg>
          </div>
          <div className="deco deco-6" aria-hidden="true">
            <svg width="54" height="24" viewBox="0 0 54 24" fill="none">
              <rect x="1.25" y="1.25" width="51.5" height="21.5" rx="10.75" fill="#ffffff" stroke="#7ddff8" strokeWidth="2.5" />
              <rect x="27" y="2.5" width="24.5" height="19" rx="9.5" fill="rgba(19,182,236,.20)" />
            </svg>
          </div>
          <div className="deco deco-7" aria-hidden="true">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <circle cx="9" cy="9" r="7" fill="rgba(19,182,236,.18)" stroke="#13b6ec" strokeWidth="2" />
            </svg>
          </div>
          <div className="deco deco-8" aria-hidden="true">
            <svg width="48" height="18" viewBox="0 0 48 18" fill="none">
              <rect x="1.25" y="1.25" width="45.5" height="15.5" rx="7.75" stroke="#8ae6fb" strokeWidth="2.5" />
            </svg>
          </div>

          <div className="container hero-content hero-inner">
            <p className="hero-eyebrow reveal"><span className="badge-pulse" aria-hidden="true"></span>Trusted by 50,000+ patients worldwide</p>
            <h1 className="hero-headline reveal">Your Health Is <br className="br-desktop" /><span>Our Priority</span></h1>
            <p className="hero-sub reveal">Find the right medication and dosage quickly and safely.<br className="br-desktop" />Smart tools to understand and manage your prescriptions with confidence.</p>

            <div className="hero-search-wrap reveal" ref={searchWrapRef}>
              <div className="hero-search">
                <div className="hero-search-inner">
                  <svg className="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#9794AA" strokeWidth="2.2">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                  <input
                    id="heroSearch"
                    type="search"
                    placeholder="Search for a drug, symptom, or condition…"
                    autoComplete="off"
                    aria-label="Search medications"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setIsSuggestionOpen(suggestionItems.length > 0 || e.target.value.trim().length > 0);
                      setActiveSuggestionIndex(-1);
                    }}
                    onFocus={() => {
                      setIsSuggestionOpen(true);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        if (activeSuggestionIndex >= 0 && suggestionItems[activeSuggestionIndex]) {
                          goToResults(suggestionItems[activeSuggestionIndex].term);
                        } else {
                          handleSearch();
                        }
                        return;
                      }
                      if (e.key === 'ArrowDown') {
                        if (suggestionItems.length === 0) return;
                        e.preventDefault();
                        setIsSuggestionOpen(true);
                        setActiveSuggestionIndex((prev) => {
                          const next = prev + 1;
                          return next >= suggestionItems.length ? 0 : next;
                        });
                      }
                      if (e.key === 'ArrowUp') {
                        if (suggestionItems.length === 0) return;
                        e.preventDefault();
                        setActiveSuggestionIndex((prev) => {
                          if (prev <= 0) return suggestionItems.length - 1;
                          return prev - 1;
                        });
                      }
                      if (e.key === 'Escape') {
                        setIsSuggestionOpen(false);
                        setActiveSuggestionIndex(-1);
                      }
                    }}
                  />
                </div>
                <div className="search-right">
                  <button type="button" className="btn-ai" onClick={handleAskAI} aria-label="Ask AI in chatbot">
                    <svg className="ai-gem" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path fillRule="evenodd" clipRule="evenodd" d="M9 4.5a.75.75 0 01.721.544l.813 2.846a3.75 3.75 0 002.576 2.576l2.846.813a.75.75 0 010 1.442l-2.846.813a3.75 3.75 0 00-2.576 2.576l-.813 2.846a.75.75 0 01-1.442 0l-.813-2.846a3.75 3.75 0 00-2.576-2.576l-2.846-.813a.75.75 0 010-1.442l2.846-.813A3.75 3.75 0 007.466 7.89l.813-2.846A.75.75 0 019 4.5zM18 1.5a.75.75 0 01.728.568l.258 1.036c.236.94.97 1.674 1.91 1.91l1.036.258a.75.75 0 010 1.456l-1.036.258c-.94.236-1.674.97-1.91 1.91l-.258 1.036a.75.75 0 01-1.456 0l-.258-1.036a2.625 2.625 0 00-1.91-1.91l-1.036-.258a.75.75 0 010-1.456l1.036-.258a2.625 2.625 0 001.91-1.91l.258-1.036A.75.75 0 0118 1.5z" />
                    </svg>
                    <span>AI</span>
                  </button>
                  <span className="vdivider" aria-hidden="true"></span>
                  <button className="btn-search" onClick={handleSearch}>Search</button>
                </div>
              </div>
              <div className={`search-dropdown ${isSuggestionOpen && suggestionItems.length > 0 ? 'open' : ''}`} id="searchDropdown">
                {suggestionItems.map((item, index) => (
                  <div
                    key={item.id ?? item.term}
                    className={`search-result-item ${index === activeSuggestionIndex ? 'active' : ''}`}
                    onMouseEnter={() => setActiveSuggestionIndex(index)}
                  >
                    <button
                      type="button"
                      className="search-result-main"
                      onClick={() => goToResults(item.term)}
                    >
                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2" strokeLinecap="round">
                        <circle cx="11" cy="11" r="8" />
                        <path d="m21 21-4.35-4.35" />
                      </svg>
                      <span>{item.term}</span>
                    </button>
                    <button
                      type="button"
                      className="search-result-remove"
                      aria-label={`Remove ${item.term} from search history`}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleRemoveHistoryItem(item);
                      }}
                      disabled={removingHistoryId === item.id}
                    >
                      x
                    </button>
                  </div>
                ))}
              </div>
            </div>

            <div className="hero-tags quick-row reveal">
              <span className="tags-label quick-label">Popular:</span>
              <button className="hero-tag" onClick={() => setQuery('Ibuprofen')}>Ibuprofen</button>
              <button className="hero-tag" onClick={() => setQuery('Amoxicillin')}>Amoxicillin</button>
              <button className="hero-tag" onClick={() => setQuery('Metformin')}>Metformin</button>
              <button className="hero-tag" onClick={() => setQuery('Lisinopril')}>Lisinopril</button>
            </div>

          </div>

          <div className="hero-wave" aria-hidden="true">
            <svg viewBox="0 0 1440 80" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M0,32 C180,72 360,8 540,44 C720,80 900,16 1080,44 C1260,72 1380,28 1440,40 L1440,80 L0,80 Z" fill="#ffffff" />
            </svg>
          </div>
        </section>

        {/* FEATURES / SERVICES */}
        <section className="features" id="services">
          <div className="container features-inner">
            <div className="features-left reveal-left">
              <h2 className="sec-title">We are providing<br /><em>specialized tool.</em></h2>
              <p className="sec-sub">DoseFinder helps patients and caregivers search medications, discover safe alternatives, get AI-powered answers, and save important information - all in one place.</p>
              <div className="illus-wrap">
                <img
                  id="mainIllustration"
                  src={mainIllustration}
                  alt="DoseFinder illustration — doctor and patient"
                  className="illus-img"
                />
                <div className="illus-blob" aria-hidden="true"></div>
              </div>
            </div>

            <div className="features-right">
              <article className="feat-card reveal-up" style={{ '--d': '0ms' }}>
                <div className="feat-icon feat-icon--blue">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                  </svg>
                </div>
                <div className="feat-body">
                  <h3>Drug Search</h3>
                  <p>Search any medication to find its uses, correct dosage, side effects, and interactions quickly and accurately.</p>
                </div>
              </article>

              <article className="feat-card reveal-up" style={{ '--d': '110ms' }}>
                <div className="feat-icon feat-icon--teal">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                  </svg>
                </div>
                <div className="feat-body">
                  <h3>Alternatives Suggestion</h3>
                  <p>Get data-backed alternatives to a given medicine — for health, allergy, cost, or availability reasons.</p>
                </div>
              </article>

              <article className="feat-card reveal-up" style={{ '--d': '220ms' }}>
                <div className="feat-icon feat-icon--purple">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <div className="feat-body">
                  <h3>AI Chatbot</h3>
                  <p>Ask questions about medication interactions, timing, or side effects and get instant AI-powered answers.</p>
                </div>
              </article>

              <article className="feat-card reveal-up" style={{ '--d': '330ms' }}>
                <div className="feat-icon feat-icon--orange">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                    <path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2v16z" />
                  </svg>
                </div>
                <div className="feat-body">
                  <h3>Bookmark</h3>
                  <p>Save your most-searched medications and dosage guides so the information is always a click away.</p>
                </div>
              </article>
            </div>
          </div>
        </section>

        {/* FAQ */}
        <section className="faq" id="faq">
          <div className="container faq-wrap">
            <div className="sec-header reveal" style={{ textAlign: 'center' }}>
              <span className="sec-eyebrow">FAQ</span>
              <h2 className="sec-title">Frequently Asked Question</h2>
              <p className="sec-sub" style={{ maxWidth: '540px', margin: '0 auto' }}>Everything you need to know about DoseFinder - answered clearly and honestly.</p>
            </div>

            <div className="faq-list reveal">
              {[
                { q: 'Is DoseFinder a replacement for my doctor or pharmacist?', a: 'No. DoseFinder is an informational tool designed to help you better understand medications. It is not a substitute for professional medical advice, diagnosis, or treatment. Always consult your doctor or pharmacist before making any changes to your medication routine.' },
                { q: 'Is my information safe when using DoseFinder?', a: 'Absolutely. We take your privacy seriously. DoseFinder does not store personally identifiable health data. All searches are encrypted and your information is never sold to third parties. Please review our Privacy Policy for full details.' },
                { q: 'Is DoseFinder free to use?', a: 'Yes! The core features of DoseFinder — including drug search, alternatives suggestion, and the AI chatbot — are completely free.' },
                { q: 'How accurate is the drug information provided?', a: 'Our drug database is sourced from verified pharmaceutical databases including FDA-approved labeling and WHO guidelines. Data is reviewed regularly by licensed pharmacists. However, always verify critical dosage decisions with a healthcare professional.' }
              ].map((faq, i) => (
                <div className={`faq-item ${openFaq === i ? 'open' : ''}`} key={i}>
                  <button className="faq-q" aria-expanded={openFaq === i} onClick={() => toggleFaq(i)}>
                    {faq.q}
                    <span className="faq-chevron" aria-hidden="true">
                      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round"><polyline points="6 9 12 15 18 9" /></svg>
                    </span>
                  </button>
                  <div className="faq-a" style={{ display: openFaq === i ? 'block' : 'none' }}>
                    <p>{faq.a}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

      </main>
      <Footer />
    </>
  );
}
