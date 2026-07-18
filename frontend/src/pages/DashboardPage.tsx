import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import SessionExpired from '../components/SessionExpired';
import { getRandomGreeting } from '../utils/greetings';

interface User {
  id: string;
  display_name: string;
  role: string;
}

interface FeatureCard {
  title: string;
  description: string;
  href?: string;
  adminOnly?: boolean;
}

const FEATURES: FeatureCard[] = [
  { title: 'Quizzes', description: 'Generate a fresh quiz and test what you actually remember.', href: '/generate' },
  { title: 'Sources', description: 'Browse the textbooks your quizzes are pulled from.', href: '/upload', adminOnly: true },
  { title: 'Upload Books', description: 'Add new course material for the AI to draw questions from.', href: '/upload', adminOnly: true },
  { title: 'Evaluation', description: 'See how your answers were actually scored, concept by concept.', href: '/evaluation' },
  { title: 'Recommendations', description: "What to study next, based on where you're actually weak." },
  { title: 'Goals', description: 'Set a target and track how close you are to reaching it.' },
];

function FeatureTile({ feature, onNavigate }: { feature: FeatureCard; onNavigate: (href: string) => void }) {
  const clickable = Boolean(feature.href);

  function handlePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const rect = e.currentTarget.getBoundingClientRect();
    e.currentTarget.style.setProperty('--x', `${e.clientX - rect.left}px`);
    e.currentTarget.style.setProperty('--y', `${e.clientY - rect.top}px`);
  }

  return (
    <div
      className={`feature-tile${clickable ? ' feature-tile--clickable' : ''}`}
      onPointerMove={handlePointerMove}
      onClick={clickable ? () => onNavigate(feature.href!) : undefined}
      role={clickable ? 'button' : undefined}
      tabIndex={clickable ? 0 : undefined}
    >
      <div className="feature-tile__content">
        <span className="feature-tile__title">{feature.title}</span>
        <span className="feature-tile__desc">{feature.description}</span>
        {!clickable && <span className="feature-tile__badge">Coming soon</span>}
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [greeting, setGreeting] = useState(getRandomGreeting);
  const [greetingVisible, setGreetingVisible] = useState(true);

  // Rotates the greeting every 10-15s (randomized so it doesn't feel
  // mechanical), with a fade-and-slide exit before the swap and a matching
  // entrance after — plain setTimeout chain, no animation library.
  useEffect(() => {
    let timeoutId: number;
    let swapId: number;

    function scheduleNext() {
      const delay = 10000 + Math.random() * 5000;
      timeoutId = window.setTimeout(() => {
        setGreetingVisible(false);
        swapId = window.setTimeout(() => {
          setGreeting((prev) => {
            let next = getRandomGreeting();
            for (let attempts = 0; next === prev && attempts < 5; attempts++) {
              next = getRandomGreeting();
            }
            return next;
          });
          setGreetingVisible(true);
          scheduleNext();
        }, 400);
      }, delay);
    }

    scheduleNext();
    return () => {
      window.clearTimeout(timeoutId);
      window.clearTimeout(swapId);
    };
  }, []);

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

  if (error) {
    return <SessionExpired />;
  }

  return (
    <div style={styles.page} className="show-cursor">
      <AppHeader />

      <main style={styles.main}>
        <h1
          style={{
            ...styles.title,
            opacity: greetingVisible ? 1 : 0,
            transform: greetingVisible ? 'translateY(0)' : 'translateY(-14px)',
          }}
        >
          {greeting}
        </h1>

        {user ? (
          <>
            <p style={styles.meta}>
              {user.display_name} &nbsp;·&nbsp; {user.role}
            </p>
            <div className="features-grid">
              {FEATURES.filter((f) => !f.adminOnly || user.role === 'admin').map((f) => (
                <FeatureTile key={f.title} feature={f} onNavigate={navigate} />
              ))}
            </div>
          </>
        ) : (
          <p style={styles.text}>Loading…</p>
        )}
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    fontFamily: "'Poppins', sans-serif",
    transition: 'background 0.35s ease',
  },
  main: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    textAlign: 'center',
    minHeight: 'calc(100vh - 72px)',
    padding: '32px 24px',
    boxSizing: 'border-box',
  },
  title: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '2rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: '0 0 20px',
    color: 'var(--text)',
    transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), color 0.35s ease',
  },
  text: {
    fontSize: 15,
    margin: 0,
    color: 'var(--text-secondary)',
  },
  meta: {
    fontSize: 13,
    color: 'var(--text-meta)',
    margin: '0 0 20px',
  },
};
