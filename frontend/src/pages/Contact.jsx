import { useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function Contact() {
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
          <span className="sec-eyebrow">Contact</span>
          <h1 className="sec-title">Get in touch</h1>
          <p className="sec-sub" style={{ maxWidth: '620px', margin: '0 auto' }}>
            Have a question, some feedback, or spotted something that looks off? We'd love to hear
            from you.
          </p>
        </div>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>Email us</h2>
          <p className="sec-sub" style={{ marginBottom: '16px' }}>
            The fastest way to reach the DoseFinder team is by email. We read every message and
            usually reply within a couple of business days.
          </p>
          <a href="mailto:info@dosefinder.com" className="btn-primary">info@dosefinder.com</a>
        </section>

        <section style={{ marginBottom: '28px' }}>
          <h2 className="sec-title" style={{ fontSize: '1.4rem', marginBottom: '10px' }}>Looking for help?</h2>
          <p className="sec-sub">
            For common questions about how DoseFinder works, our <Link to="/support">Support</Link> page
            and the FAQ on the home page cover the basics.
          </p>
        </section>
      </main>
      <Footer />
    </>
  );
}
