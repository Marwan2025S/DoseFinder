import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function About() {
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
          <span className="sec-eyebrow">About Us</span>
          <h1 className="sec-title">Medication clarity, for everyone</h1>
          <p className="sec-sub" style={{ maxWidth: '620px', margin: '0 auto' }}>
            DoseFinder is a smart and easy-to-use tool that helps people find and understand
            information about their medications quickly and accurately.
          </p>
        </div>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>Our mission</h2>
          <p className="sec-sub">
            Medication information is often scattered, full of jargon, or hard to trust. We bring it
            together in one place — clear dosage guidance, alternatives, and instant answers — so you
            can make informed decisions with confidence. DoseFinder is an informational companion, not
            a replacement for your doctor or pharmacist.
          </p>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>What we do</h2>
          <p className="sec-sub">
            Search a medication and get verified information sourced from trusted pharmaceutical
            databases. Discover data-backed alternatives for health, allergy, cost, or availability
            reasons. Ask our AI chatbot about interactions, timing, or side effects, and bookmark the
            guides you rely on most.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
