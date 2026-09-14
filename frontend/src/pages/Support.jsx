import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Support() {
  const navigate = useNavigate();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  const goHome = () => {
    window.scrollTo(0, 0);
    navigate('/');
  };

  return (
    <>
      <Navbar />
      <main className="container" style={{ padding: '80px 24px 100px', maxWidth: '820px' }}>
        <button type="button" className="util-back-btn" onClick={goHome} aria-label="Back to home" style={{ marginBottom: '24px' }}>
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="19" y1="12" x2="5" y2="12" />
            <polyline points="12 19 5 12 12 5" />
          </svg>
        </button>
        <div className="sec-header" style={{ textAlign: 'center', marginBottom: '32px' }}>
          <span className="sec-eyebrow">Support</span>
          <h1 className="sec-title">How can we help?</h1>
          <p className="sec-sub" style={{ maxWidth: '620px', margin: '0 auto' }}>
            Everything you need to get the most out of DoseFinder — and where to turn when you're
            stuck.
          </p>
        </div>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>Getting started</h2>
          <p className="sec-sub">
            Search any medication to view dosage guidance and verified information, explore data-backed
            alternatives, or ask the AI chatbot about interactions, timing, and side effects. Save the
            guides you use most with a bookmark so they're always a click away.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>Frequently asked questions</h2>
          <p className="sec-sub">
            Many common questions — about accuracy, privacy, and what DoseFinder is (and isn't) — are
            answered in the <Link to="/#faq">FAQ section</Link> on our home page.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>Still need help?</h2>
          <p className="sec-sub" style={{ marginBottom: '16px' }}>
            If you can't find what you're looking for, reach out and we'll get back to you.
          </p>
          <Link to="/contact" className="btn-primary">Contact Us</Link>
        </section>
      </main>
      <Footer />
    </>
  );
}
