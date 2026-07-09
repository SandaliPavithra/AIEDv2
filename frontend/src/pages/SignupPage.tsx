import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';

export default function SignupPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, display_name: displayName || undefined }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.detail ?? 'Registration failed');

      localStorage.setItem('access_token', data.access_token);
      navigate('/dashboard', { replace: true });
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={s.page} className="show-cursor">
      <div style={{ position: 'fixed', top: 16, right: 16 }}>
        <ThemeToggle />
      </div>
      <form style={s.card} onSubmit={handleSubmit}>
        <h1 style={s.title}>Sign up</h1>

        <label style={s.label}>Email</label>
        <input
          style={s.input}
          type="email"
          value={email}
          onChange={e => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          autoFocus
        />

        <label style={s.label}>Display name <span style={s.optional}>(optional)</span></label>
        <input
          style={s.input}
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder="Leave blank for a random name"
        />

        <label style={s.label}>Password</label>
        <input
          style={s.input}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
          minLength={8}
        />

        {error && <p style={s.error}>{error}</p>}

        <button style={s.btn} type="submit" disabled={loading}>
          {loading ? 'Creating account…' : 'Create account'}
        </button>

        <p style={s.footer}>
          Already have an account? <Link to="/login" style={s.link}>Log in</Link>
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
    fontFamily: 'sans-serif',
    cursor: 'default',
    transition: 'background 0.35s ease',
  },
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 12,
    padding: '36px 32px',
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    transition: 'background 0.35s ease, border-color 0.35s ease',
  },
  title: { color: 'var(--text)', fontSize: 22, fontWeight: 700, margin: '0 0 8px' },
  label: { color: 'var(--text-meta)', fontSize: 13 },
  optional: { color: 'var(--text-note)', fontSize: 12 },
  input: {
    padding: '9px 12px',
    borderRadius: 7,
    border: '1px solid var(--btn-border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
    cursor: 'text',
  },
  btn: {
    marginTop: 8,
    padding: '10px',
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 7,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  footer: { color: 'var(--text-note)', fontSize: 13, textAlign: 'center', margin: 0 },
  link: { color: 'var(--text)', textDecoration: 'underline', cursor: 'pointer' },
};
