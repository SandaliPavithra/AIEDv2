import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';

export default function CallbackPage() {
  const navigate = useNavigate();
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const code = params.get('code');
    const oauthError = params.get('error');

    if (oauthError) {
      setError(params.get('error_description') ?? oauthError);
      return;
    }

    if (!code) {
      setError('No authorization code received.');
      return;
    }

    const redirectUri = sessionStorage.getItem('oauth_redirect_uri') ?? `${window.location.origin}/callback`;
    const apiUrl = import.meta.env.VITE_API_URL;

    fetch(`${apiUrl}/auth/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, redirect_uri: redirectUri }),
    })
      .then((res) => {
        if (!res.ok) return res.json().then((d) => Promise.reject(d.detail ?? 'Auth failed'));
        return res.json();
      })
      .then((data) => {
        localStorage.setItem('access_token', data.access_token);
        sessionStorage.removeItem('oauth_redirect_uri');
        navigate('/dashboard', { replace: true });
      })
      .catch((err) => setError(String(err)));
  }, [navigate]);

  if (error) {
    return (
      <div style={styles.container} className="show-cursor">
        <div style={styles.card}>
          <p style={styles.errorTitle}>Login failed</p>
          <p style={styles.errorMsg}>{error}</p>
          <button style={styles.retryBtn} onClick={() => navigate('/login')}>
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={styles.container} className="show-cursor">
      <div style={styles.card}>
        <div style={styles.spinner} />
        <p style={styles.loadingText}>Signing you in…</p>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    minHeight: '100vh',
    background: '#0a0a0a',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontFamily: 'sans-serif',
  },
  card: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 24,
    padding: '48px 40px',
    width: 320,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    color: '#fff',
  },
  spinner: {
    width: 36,
    height: 36,
    border: '3px solid rgba(255,255,255,0.15)',
    borderTopColor: '#fff',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    margin: 0,
  },
  errorTitle: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
  },
  errorMsg: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: 13,
    textAlign: 'center',
    margin: 0,
  },
  retryBtn: {
    marginTop: 8,
    padding: '10px 24px',
    background: '#fff',
    color: '#000',
    border: 'none',
    borderRadius: 8,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
  },
};
