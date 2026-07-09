import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function handleGlowMove(e: React.MouseEvent<HTMLButtonElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--pointer-x', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--pointer-y', `${e.clientY - rect.top}px`);
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const form = new URLSearchParams();
      form.append('username', email);
      form.append('password', password);

      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: form,
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? 'Login failed');

      localStorage.setItem('access_token', data.access_token);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page} className="show-cursor">
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <form style={s.container} onSubmit={handleSubmit}>
        <h1 style={s.title}>Sign In</h1>

        <div style={s.fieldRow}>
          <label style={s.fieldLabel}>Email Address:</label>
          <div className="signin-field" style={s.fieldInputWrap}>
            <input
              className="signin-input"
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="Enter Email Address"
              required
              autoFocus
            />
          </div>
        </div>

        <div style={s.fieldRow}>
          <label style={s.fieldLabel}>Password:</label>
          <div className="signin-field" style={s.fieldInputWrap}>
            <input
              className="signin-input"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter Password"
              required
            />
            <button
              type="button"
              onClick={() => setShowPassword(v => !v)}
              style={s.eyeBtn}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              tabIndex={-1}
            >
              {showPassword ? (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a18.4 18.4 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 7 11 7a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
                  <path d="M1 1l22 22" />
                </svg>
              ) : (
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" />
                  <circle cx="12" cy="12" r="3" />
                </svg>
              )}
            </button>
          </div>
        </div>

        {error && <p style={s.error}>{error}</p>}

        <button className="glow-btn" type="submit" disabled={loading} onMouseMove={handleGlowMove}>
          <span className="glow-btn__ring" aria-hidden="true" />
          <span className="glow-btn__face">{loading ? 'Signing In…' : 'Sign In'}</span>
        </button>

        <p style={s.footer}>
          No account? <Link to="/signup" style={s.link}>Sign up</Link>
        </p>
      </form>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: "'Poppins', sans-serif",
    cursor: 'default',
    transition: 'background 0.35s ease',
  },
  container: {
    width: 360,
    display: 'flex',
    flexDirection: 'column',
    gap: 26,
  },
  title: {
    color: 'var(--text)',
    fontSize: '2rem',
    fontWeight: 800,
    letterSpacing: '0.03em',
    textTransform: 'uppercase',
    textAlign: 'center',
    textShadow: '3px 3px 0 var(--title-shadow)',
    margin: '0 0 8px',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
  },
  fieldLabel: {
    color: 'var(--text)',
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  fieldInputWrap: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  eyeBtn: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'none',
    border: 'none',
    padding: 4,
    margin: 0,
    color: 'var(--text-note)',
    cursor: 'pointer',
    flexShrink: 0,
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  footer: { color: 'var(--text-note)', fontSize: 13, textAlign: 'center', margin: 0 },
  link: { color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer' },
};
