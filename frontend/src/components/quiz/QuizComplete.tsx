import { useNavigate } from 'react-router-dom';

interface QuizCompleteProps {
  onRestart: () => void;
}

export default function QuizComplete({ onRestart }: QuizCompleteProps) {
  const navigate = useNavigate();

  return (
    <div style={s.card}>
      <h1 style={s.title}>Quiz complete</h1>
      <p style={s.text}>
        Your answers have been recorded. Results and feedback will be available once the
        Evaluation dashboard is ready.
      </p>
      <div style={s.actions}>
        <button style={s.btnPrimary} onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        <button style={s.btnSecondary} onClick={onRestart}>Start another quiz</button>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 24,
    padding: '48px 40px',
    width: 420,
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    color: 'var(--text)',
  },
  title: { fontSize: 26, fontWeight: 800, letterSpacing: '-0.04em', margin: 0, color: 'var(--text)' },
  text: { fontSize: 14, color: 'var(--text-secondary)', margin: 0, lineHeight: 1.6 },
  actions: { display: 'flex', gap: 10, marginTop: 12 },
  btnPrimary: {
    flex: 1,
    padding: '12px',
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  btnSecondary: {
    flex: 1,
    padding: '12px',
    background: 'transparent',
    color: 'var(--btn-text)',
    border: '1px solid var(--btn-border)',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
};
