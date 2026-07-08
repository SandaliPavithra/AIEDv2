import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

interface User {
  id: string;
  display_name: string;
  role: string;
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') !== 'light');

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }

    fetch(`${import.meta.env.VITE_API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(d.detail ?? 'Unauthorized'));
        return res.json();
      })
      .then(setUser)
      .catch((err) => {
        setError(String(err));
        localStorage.removeItem('access_token');
      });
  }, [navigate]);

  function handleLogout() {
    localStorage.removeItem('access_token');
    navigate('/login', { replace: true });
  }

  if (error) {
    return (
      <div style={styles.page} className="show-cursor">
        <div style={styles.card}>
          <p style={{ color: 'var(--text)' }}>
            Session expired.{' '}
            <button style={styles.link} onClick={() => navigate('/login')}>
              Log in again
            </button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.page} className="show-cursor">
      <header style={styles.header}>
        <span style={styles.headerTitle}>Dashboard</span>
        <div style={styles.headerActions}>
          <button
            className="theme-toggle"
            onClick={() => setIsDark((d) => !d)}
            aria-label="Toggle light / dark mode"
          >
            <span className="toggle-orb" />
          </button>
          <button style={styles.logoutBtn} onClick={handleLogout}>
            Log out
          </button>
        </div>
      </header>

      <main style={styles.main}>
        <div style={styles.card}>
          <h1 style={styles.title}>
            Welcome back{user ? `, ${user.display_name}` : ''}
          </h1>
          {user ? (
            <>
              <p style={styles.meta}>Role: {user.role} &nbsp;|&nbsp; ID: {user.id}</p>
              <button style={styles.generateBtn} onClick={() => navigate('/generate')}>
                Start a quiz
              </button>
              {user.role === 'admin' && (
                <button style={styles.uploadBtn} onClick={() => navigate('/upload')}>
                  Upload a book
                </button>
              )}
            </>
          ) : (
            <p style={styles.text}>Loading…</p>
          )}
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    fontFamily: 'sans-serif',
    transition: 'background 0.35s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    height: 64,
    background: 'var(--header-bg)',
    borderBottom: '1px solid var(--header-border)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    transition: 'background 0.35s ease, border-color 0.35s ease',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
    transition: 'color 0.35s ease',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(100vh - 64px)',
    padding: '32px 16px',
  },
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 24,
    padding: '48px 40px',
    width: 400,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    color: 'var(--text)',
    transition: 'background 0.35s ease, border-color 0.35s ease',
  },
  title: {
    fontSize: 26,
    fontWeight: 800,
    letterSpacing: '-0.04em',
    margin: 0,
    color: 'var(--text)',
    transition: 'color 0.35s ease',
  },
  text: {
    fontSize: 15,
    margin: 0,
    color: 'var(--text-secondary)',
  },
  meta: {
    fontSize: 12,
    color: 'var(--text-meta)',
    margin: 0,
  },
  note: {
    fontSize: 13,
    color: 'var(--text-note)',
    margin: 0,
    marginTop: 8,
  },
  generateBtn: {
    marginTop: 12,
    padding: '12px',
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  uploadBtn: {
    marginTop: 8,
    padding: '12px',
    background: 'transparent',
    color: 'var(--btn-text)',
    border: '1px solid var(--btn-border)',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
  logoutBtn: {
    padding: '8px 20px',
    background: 'transparent',
    color: 'var(--btn-text)',
    border: '1px solid var(--btn-border)',
    borderRadius: 8,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
    transition: 'color 0.35s ease, border-color 0.35s ease',
  },
  link: {
    background: 'none',
    border: 'none',
    color: 'var(--text)',
    cursor: 'pointer',
    fontWeight: 600,
    textDecoration: 'underline',
    padding: 0,
  },
};
