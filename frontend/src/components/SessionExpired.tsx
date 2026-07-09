export default function SessionExpired() {
  return (
    <div style={s.page} className="show-cursor">
      <div style={s.container}>
        <h1 style={s.title}>Oops! Seems like the session got expired...</h1>
        <p style={s.subtitle}>Try Refreshing the site, check your connection or try again later</p>
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    display: 'flex',
    alignItems: 'center',
    fontFamily: "'Poppins', sans-serif",
    transition: 'background 0.35s ease',
  },
  container: {
    maxWidth: 660,
    padding: '0 80px',
  },
  title: {
    color: 'var(--text)',
    fontSize: '2.75rem',
    fontWeight: 600,
    lineHeight: 1.15,
    margin: '0 0 16px',
  },
  subtitle: {
    color: 'var(--text-secondary)',
    fontSize: 14,
    fontWeight: 400,
    margin: 0,
  },
};
