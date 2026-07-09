import { useNavigate } from 'react-router-dom';
import ThemeToggle from './components/ThemeToggle';

export default function App() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', transition: 'background 0.35s ease' }}>
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <main style={{ textAlign: 'center', padding: '0 32px', maxWidth: 768 }}>
        <h1 style={{ color: 'var(--text)', fontWeight: 700, fontSize: '2.5rem', lineHeight: 1.3, marginBottom: 48, fontFamily: 'sans-serif', transition: 'color 0.35s ease' }}>
          Artificial Intelligence in Education for Evaluation, Recommendation and Generation
        </h1>
        <button
          onClick={() => navigate('/login')}
          style={{ background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 9999, padding: '14px 40px', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}
        >
          Log in
        </button>
      </main>
    </div>
  );
}
