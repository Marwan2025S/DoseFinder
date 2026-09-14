import { Link } from 'react-router-dom';
import Navbar from '../components/Navbar';
import Footer from '../components/Footer';

export default function NotFound() {
  return (
    <>
      <Navbar />
      <main className="container" style={{ padding: '80px 24px 100px' }}>
        <h1 className="sec-title">Page Not Found</h1>
        <p className="sec-sub" style={{ marginBottom: '24px' }}>
          The page you requested does not exist or was moved.
        </p>
        <Link to="/" className="btn-primary">
          Back To Home
        </Link>
      </main>
      <Footer />
    </>
  );
}
