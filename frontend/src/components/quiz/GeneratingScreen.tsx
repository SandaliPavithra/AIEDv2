import { useEffect, useState } from 'react';

interface GeneratingScreenProps {
  error: string | null;
  onRetry: () => void;
}

const STATUS_MESSAGES = [
  'Gathering your topics…',
  'Digging through the chapters…',
  'Finding the good stuff…',
  'Drafting questions…',
  'Double-checking the answers…',
  'Almost ready…',
];

const MESSAGE_DISPLAY_MS = 2000;
const MESSAGE_SWAP_MS = 400;

export default function GeneratingScreen({ error, onRetry }: GeneratingScreenProps) {
  const [messageIndex, setMessageIndex] = useState(0);
  const [messageVisible, setMessageVisible] = useState(true);

  // Same fade-and-slide swap as the dashboard's greeting rotation, just on a
  // fixed (not randomized) cadence — this is a loading indicator, not a
  // leisurely greeting.
  useEffect(() => {
    let displayId: number;
    let swapId: number;

    function scheduleNext() {
      displayId = window.setTimeout(() => {
        setMessageVisible(false);
        swapId = window.setTimeout(() => {
          setMessageIndex((i) => (i + 1) % STATUS_MESSAGES.length);
          setMessageVisible(true);
          scheduleNext();
        }, MESSAGE_SWAP_MS);
      }, MESSAGE_DISPLAY_MS);
    }

    scheduleNext();
    return () => {
      window.clearTimeout(displayId);
      window.clearTimeout(swapId);
    };
  }, []);

  return (
    <div style={s.card}>
      {error ? (
        <>
          <p style={s.errorText}>{error}</p>
          <button style={s.btn} onClick={onRetry}>Retry</button>
        </>
      ) : (
        <div style={s.loadingRow}>
          <div className="pl" style={s.spinner}>
            <div className="pl__dot">
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
            </div>
            <div className="pl__dot">
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
            </div>
            <div className="pl__dot">
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
            </div>
            <div className="pl__dot">
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
            </div>
            <div className="pl__dot">
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
            </div>
            <div className="pl__dot">
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
              <div className="pl__dot-layer" />
            </div>
          </div>
          <p
            style={{
              ...s.text,
              opacity: messageVisible ? 1 : 0,
              transform: messageVisible ? 'translateY(0)' : 'translateY(-14px)',
            }}
          >
            {STATUS_MESSAGES[messageIndex]}
          </p>
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 16,
    color: 'var(--text)',
  },
  loadingRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 20,
  },
  spinner: {
    fontSize: 6.5,
  },
  text: {
    fontSize: 14,
    fontFamily: "'Poppins', sans-serif",
    fontWeight: 600,
    color: 'var(--text-secondary)',
    margin: 0,
    transition: 'opacity 0.4s cubic-bezier(0.16, 1, 0.3, 1), transform 0.4s cubic-bezier(0.16, 1, 0.3, 1)',
  },
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
