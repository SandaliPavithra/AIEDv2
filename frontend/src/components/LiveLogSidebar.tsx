import { useEffect, useRef, useState } from 'react';

interface LogLine {
  time: string;
  level: string;
  logger: string;
  request_id: string;
  message: string;
  exc?: string;
}

interface LiveLogSidebarProps {
  open: boolean;
  onToggle: () => void;
}

const LEVEL_COLORS: Record<string, string> = {
  DEBUG: '#9ca3af',
  INFO: '#e5e7eb',
  WARNING: '#fbbf24',
  ERROR: '#f87171',
  CRITICAL: '#f87171',
};

const PANEL_WIDTH = 440;
const RECONNECT_DELAY_MS = 2000;
const MAX_LINES = 500;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function LiveLogSidebar({ open, onToggle }: LiveLogSidebarProps) {
  const [lines, setLines] = useState<LogLine[]>([]);
  const [connected, setConnected] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Stays mounted across route changes (lives above the router) — the SSE
  // connection persists as long as the panel is open, regardless of which
  // page is behind it, same as browser devtools staying open across tabs.
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let cancelled = false;

    async function connectOnce() {
      const res = await fetch(`${import.meta.env.VITE_API_URL}/logs/stream`, {
        headers: { Authorization: `Bearer ${localStorage.getItem('access_token')}` },
        signal: controller.signal,
      });
      if (!res.ok || !res.body) throw new Error('Failed to connect to log stream');
      setConnected(true);

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const evt of events) {
          const dataLine = evt.split('\n').find((l) => l.startsWith('data: '));
          if (!dataLine) continue;
          try {
            const parsed: LogLine = JSON.parse(dataLine.slice(6));
            setLines((prev) => [...prev.slice(-(MAX_LINES - 1)), parsed]);
          } catch {
            // malformed line — skip it
          }
        }
      }
    }

    async function loop() {
      while (!cancelled) {
        try {
          await connectOnce();
        } catch {
          // connection dropped or failed — retry below
        }
        setConnected(false);
        if (!cancelled) await sleep(RECONNECT_DELAY_MS);
      }
    }

    loop();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [open]);

  useEffect(() => {
    containerRef.current?.scrollTo({ top: containerRef.current.scrollHeight });
  }, [lines]);

  return (
    <>
      <button
        onClick={onToggle}
        style={{
          ...s.toggleBtn,
          left: open ? PANEL_WIDTH + 12 : 12,
        }}
      >
        {open ? '⟨ Hide log' : '⟩ Show log'}
      </button>

      <div style={{ ...s.sidebar, transform: open ? 'translateX(0)' : 'translateX(-100%)' }}>
        <div style={s.header}>
          <span style={s.headerLabel}>Live backend log</span>
          <span style={{ ...s.status, color: connected ? '#4ade80' : '#f87171' }}>
            {connected ? '● connected' : '○ reconnecting…'}
          </span>
        </div>
        <div style={s.terminal} ref={containerRef}>
          {lines.length === 0 && <div style={s.dim}>Waiting for log output…</div>}
          {lines.map((l, i) => (
            <div key={i} style={s.line}>
              <span style={s.dim}>{l.time}</span>{' '}
              <span style={{ color: LEVEL_COLORS[l.level] ?? '#e5e7eb', fontWeight: 700 }}>[{l.level}]</span>{' '}
              <span style={s.dim}>{l.logger}:</span> {l.message}
              {l.exc && <pre style={s.exc}>{l.exc}</pre>}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}

export { PANEL_WIDTH };

const s: Record<string, React.CSSProperties> = {
  toggleBtn: {
    position: 'fixed',
    top: 12,
    zIndex: 10000,
    transition: 'left 0.25s ease',
    padding: '8px 14px',
    background: '#111111',
    color: 'rgba(255,255,255,0.75)',
    border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8,
    fontWeight: 600,
    fontSize: 12,
    cursor: 'pointer',
    fontFamily: 'sans-serif',
  },
  sidebar: {
    position: 'fixed',
    top: 0,
    left: 0,
    width: PANEL_WIDTH,
    height: '100vh',
    zIndex: 9999,
    background: '#0a0a0a',
    borderRight: '1px solid rgba(255,255,255,0.1)',
    display: 'flex',
    flexDirection: 'column',
    transition: 'transform 0.25s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '14px 16px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
    flexShrink: 0,
  },
  headerLabel: { fontSize: 13, fontWeight: 700, color: '#fff', fontFamily: 'sans-serif' },
  status: { fontSize: 12, fontWeight: 600, fontFamily: 'sans-serif' },
  terminal: {
    flex: 1,
    color: '#e5e7eb',
    fontFamily: "'Consolas', 'Menlo', monospace",
    fontSize: 12,
    lineHeight: 1.6,
    padding: '12px 14px',
    overflowY: 'auto',
  },
  line: { whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  dim: { color: '#6b7280' },
  exc: {
    margin: '4px 0 8px 0',
    padding: '8px 10px',
    background: 'rgba(248, 113, 113, 0.08)',
    border: '1px solid rgba(248, 113, 113, 0.25)',
    borderRadius: 6,
    color: '#f87171',
    fontSize: 11,
    whiteSpace: 'pre-wrap',
  },
};
