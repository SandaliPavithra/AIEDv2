import { useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from './components/ThemeToggle';
import ShaderBackground from './components/ShaderBackground';

const TITLE_TEXT = 'Artificial Intelligence in Education for Evaluation and Generation';

export default function App() {
  const navigate = useNavigate();
  const titleRef = useRef<HTMLHeadingElement>(null);

  return (
    <div style={{ position: 'relative', zIndex: 0, minHeight: '100vh', background: 'var(--bg)', display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'hidden', transition: 'background 0.35s ease' }}>
      <ShaderBackground title={TITLE_TEXT} titleRef={titleRef} />
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <main style={{ textAlign: 'center', padding: '0 32px', maxWidth: 1400 }}>
        <h1 ref={titleRef} className="landing-title" style={{ marginBottom: 48 }}>
          {TITLE_TEXT}
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
