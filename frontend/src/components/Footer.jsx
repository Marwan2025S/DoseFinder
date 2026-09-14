import { Link } from 'react-router-dom';
import { useToast } from './Toast';
import '../styles/footer.css';

export default function Footer() {
  const { showToast } = useToast();

  return (
    <footer>
      <div className="footer-inner">
        <div className="footer-top">
          <div className="footer-about">
            <h4>Who are we?</h4>
            <p>
              DoseFinder is a smart and easy-to-use tool that helps people find and understand
              information about their medications quickly and accurately.
            </p>
            <div className="contact">
              <h4>Contact</h4>
              <a href="mailto:info@dosefinder.com">info@dosefinder.com</a>
            </div>
          </div>
          <div className="footer-links-wrap">
            <div className="footer-col">
              <h5>Company</h5>
              <ul>
                <li><Link to="/about">About Us</Link></li>
                <li><Link to="/contact">Contact</Link></li>
                <li><Link to="/support">Support</Link></li>
              </ul>
            </div>
            <div className="footer-col">
              <h5>Social Media</h5>
              <ul>
                <li><a href="https://www.instagram.com" target="_blank" rel="noreferrer">Instagram</a></li>
                <li><a href="https://www.facebook.com" target="_blank" rel="noreferrer">Facebook</a></li>
                <li><a href="https://www.x.com" target="_blank" rel="noreferrer">X</a></li>
                <li><a href="https://www.youtube.com" target="_blank" rel="noreferrer">YouTube</a></li>
              </ul>
            </div>
          </div>
        </div>

        <div className="footer-bottom">
          <div className="footer-logo">DoseFinder</div>
        </div>
        <hr className="footer-divider" />
        <div className="footer-legal">
          <div>© 2026 DoseFinder. All rights reserved.</div>
          <div className="footer-legal-links">
            <button type="button" onClick={() => showToast('Terms page is coming soon.', 'info')}>Terms</button>
            <button type="button" onClick={() => showToast('Privacy policy page is coming soon.', 'info')}>Privacy</button>
            <button type="button" onClick={() => showToast('Cookie policy page is coming soon.', 'info')}>Cookies</button>
            </div>
        </div>
      </div>
    </footer>
  );
}
