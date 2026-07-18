import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import SessionExpired from '../components/SessionExpired';
import EvalChart from '../components/EvalChart';
import { useEvaluationChat } from '../hooks/useEvaluationChat';

const SUGGESTIONS = [
  'Show me my score trend over my last few answers',
  'Compare my recall, precision, and wording for my last answer',
  'What concepts am I weakest on?',
  'Am I being concise, or rambling?',
];

// Renders the small subset of Markdown the evaluation model actually produces
// (bold, bullet lists, paragraphs) — no external dependency, so nothing new
// to break right before a deadline.
function renderInline(text: string, keyPrefix: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((part, i) =>
    part.startsWith('**') && part.endsWith('**') ? (
      <strong key={`${keyPrefix}-${i}`}>{part.slice(2, -2)}</strong>
    ) : (
      <span key={`${keyPrefix}-${i}`}>{part}</span>
    )
  );
}

function renderMarkdownLite(content: string): React.ReactNode {
  const blocks: React.ReactNode[] = [];
  let listItems: string[] = [];

  const flushList = (key: string) => {
    if (listItems.length === 0) return;
    blocks.push(
      <ul key={`ul-${key}`} style={{ margin: '4px 0', paddingLeft: 20 }}>
        {listItems.map((item, i) => (
          <li key={i} style={{ marginBottom: 2 }}>
            {renderInline(item, `li-${key}-${i}`)}
          </li>
        ))}
      </ul>
    );
    listItems = [];
  };

  content.split('\n').forEach((line, idx) => {
    const trimmed = line.trim();
    const bulletMatch = trimmed.match(/^[-*]\s+(.*)/);
    if (bulletMatch) {
      listItems.push(bulletMatch[1]);
      return;
    }
    flushList(String(idx));
    if (trimmed === '') return;
    blocks.push(
      <p key={`p-${idx}`} style={{ margin: '4px 0' }}>
        {renderInline(trimmed, `p-${idx}`)}
      </p>
    );
  });
  flushList('end');

  return blocks;
}

export default function EvaluationPage() {
  const navigate = useNavigate();
  const [authError, setAuthError] = useState(false);
  const [input, setInput] = useState('');
  const { messages, loadingHistory, sending, error, sendMessage } = useEvaluationChat();
  const scrollRef = useRef<HTMLDivElement>(null);

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
        if (!res.ok) throw new Error('Unauthorized');
      })
      .catch(() => setAuthError(true));
  }, [navigate]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  if (authError) {
    return <SessionExpired />;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const content = input.trim();
    if (!content || sending) return;
    setInput('');
    sendMessage(content);
  }

  return (
    <div style={styles.page} className="show-cursor">
      <AppHeader />

      <main style={styles.main}>
        <div style={styles.chatColumn}>
          <div style={styles.chatHeader}>
            <h1 style={styles.title}>Evaluation</h1>
            <p style={styles.subtitle}>
              Ask about your real, already-scored evaluation data — every answer is grounded in your actual
              numbers, never guessed.
            </p>
          </div>

          <div style={styles.messagesBox} ref={scrollRef}>
            {loadingHistory ? (
              <p style={styles.meta}>Loading…</p>
            ) : messages.length === 0 ? (
              <div style={styles.emptyState}>
                <p style={styles.meta}>Nothing asked yet. Try:</p>
                <div style={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} style={styles.suggestionChip} onClick={() => sendMessage(s)} disabled={sending}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              messages.map((m, i) => (
                <div
                  key={i}
                  style={{
                    ...styles.bubbleRow,
                    flexDirection: 'column',
                    alignItems: m.role === 'user' ? 'flex-end' : 'flex-start',
                  }}
                >
                  <div style={m.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant}>
                    {m.role === 'user' ? m.content : renderMarkdownLite(m.content)}
                  </div>
                  {m.chart && (
                    <div style={styles.chartWrap}>
                      <EvalChart chart={m.chart} />
                    </div>
                  )}
                </div>
              ))
            )}
            {sending && (
              <div style={{ ...styles.bubbleRow, justifyContent: 'flex-start' }}>
                <div style={styles.bubbleAssistant}>Analyzing your data…</div>
              </div>
            )}
          </div>

          {error && <p style={styles.error}>{error}</p>}

          <form onSubmit={handleSubmit} style={styles.inputRow}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your evaluation…"
              style={styles.input}
              disabled={sending}
            />
            <button type="submit" style={styles.sendButton} disabled={sending || !input.trim()}>
              Send
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    height: '100vh',
    overflow: 'hidden',
    background: 'var(--bg)',
    fontFamily: "'Poppins', sans-serif",
    transition: 'background 0.35s ease',
  },
  main: {
    display: 'flex',
    justifyContent: 'center',
    height: 'calc(100vh - 72px)',
    padding: '32px 24px',
    boxSizing: 'border-box',
  },
  chatColumn: {
    width: '100%',
    maxWidth: 720,
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    minHeight: 0,
  },
  chatHeader: {
    marginBottom: 16,
    flexShrink: 0,
  },
  title: {
    fontSize: '1.75rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: '0 0 6px',
    color: 'var(--text)',
    transition: 'color 0.35s ease',
  },
  subtitle: {
    fontSize: 14,
    color: 'var(--text-secondary)',
    margin: 0,
  },
  messagesBox: {
    flex: 1,
    minHeight: 0,
    overflowY: 'auto',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '8px 4px',
  },
  bubbleRow: {
    display: 'flex',
    width: '100%',
  },
  chartWrap: {
    maxWidth: '92%',
    marginTop: 6,
    padding: '10px 14px',
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 12,
  },
  bubbleUser: {
    background: 'var(--text)',
    color: 'var(--bg)',
    borderRadius: '16px 16px 4px 16px',
    padding: '10px 16px',
    maxWidth: '80%',
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  bubbleAssistant: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    color: 'var(--text)',
    borderRadius: '16px 16px 16px 4px',
    padding: '10px 16px',
    maxWidth: '80%',
    fontSize: 14,
    lineHeight: 1.5,
    whiteSpace: 'pre-wrap',
  },
  emptyState: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    padding: '24px 4px',
  },
  suggestions: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 8,
  },
  suggestionChip: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    color: 'var(--text)',
    borderRadius: 9999,
    padding: '8px 14px',
    fontSize: 13,
    cursor: 'pointer',
  },
  meta: {
    fontSize: 13,
    color: 'var(--text-meta)',
    margin: 0,
  },
  error: {
    fontSize: 13,
    color: '#ec4b4b',
    margin: '8px 0 0',
  },
  inputRow: {
    display: 'flex',
    gap: 8,
    marginTop: 16,
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    color: 'var(--text)',
    borderRadius: 9999,
    padding: '12px 18px',
    fontSize: 14,
    outline: 'none',
  },
  sendButton: {
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 9999,
    padding: '12px 24px',
    fontWeight: 600,
    fontSize: 14,
    cursor: 'pointer',
  },
};
