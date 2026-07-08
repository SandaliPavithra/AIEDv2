interface GeneratingScreenProps {
  error: string | null;
  onRetry: () => void;
}

export default function GeneratingScreen({ error, onRetry }: GeneratingScreenProps) {
  return (
    <div style={s.card}>
      {error ? (
        <>
          <p style={s.errorText}>{error}</p>
          <button style={s.btn} onClick={onRetry}>Retry</button>
        </>
      ) : (
        <>
          <div style={s.spinner} />
          <p style={s.text}>Generating your quiz…</p>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 24,
    padding: '48px 40px',
    width: 360,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    color: 'var(--text)',
  },
  spinner: {
    width: 32,
    height: 32,
    borderRadius: '50%',
    border: '3px solid var(--card-border)',
    borderTopColor: 'var(--text)',
    animation: 'spin 0.8s linear infinite',
  },
  text: { fontSize: 14, color: 'var(--text-secondary)', margin: 0 },
  errorText: { fontSize: 14, color: '#f87171', margin: 0, textAlign: 'center' },
  btn: {
    padding: '10px 24px',
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
};
