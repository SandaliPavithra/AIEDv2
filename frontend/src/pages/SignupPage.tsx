import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';

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
    background: '#111',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'sans-serif',
    cursor: 'default',
  },
  card: {
    background: '#1a1a1a',
    border: '1px solid #333',
    borderRadius: 12,
    padding: '36px 32px',
    width: 340,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  title: { color: '#fff', fontSize: 22, fontWeight: 700, margin: '0 0 8px' },
  label: { color: '#aaa', fontSize: 13 },
  optional: { color: '#555', fontSize: 12 },
  input: {
    padding: '9px 12px',
    borderRadius: 7,
    border: '1px solid #444',
    background: '#222',
    color: '#fff',
    fontSize: 14,
    outline: 'none',
    cursor: 'text',
  },
  btn: {
    marginTop: 8,
    padding: '10px',
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 7,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  footer: { color: '#666', fontSize: 13, textAlign: 'center', margin: 0 },
  link: { color: '#fff', textDecoration: 'underline', cursor: 'pointer' },
};
