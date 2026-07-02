import { useState, FormEvent } from 'react';
import { useNavigate, Link } from 'react-router-dom';

export default function LoginPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
      <form style={s.card} onSubmit={handleSubmit}>
        <h1 style={s.title}>Log in</h1>

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

        <label style={s.label}>Password</label>
        <input
          style={s.input}
          type="password"
          value={password}
          onChange={e => setPassword(e.target.value)}
          placeholder="••••••••"
          required
        />

        {error && <p style={s.error}>{error}</p>}

        <button style={s.btn} type="submit" disabled={loading}>
          {loading ? 'Logging in…' : 'Log in'}
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
