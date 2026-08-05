import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import AppHeader from '../components/AppHeader';
import SessionExpired from '../components/SessionExpired';
import DiagramChart from '../components/DiagramChart';
import { useDeepEvaluation, type Report } from '../hooks/useDeepEvaluation';

const SUGGESTIONS = [
  'Am I doing well overall?',
  'What concepts am I weakest on?',
  'How has my performance trended over the last few weeks?',
  'Am I being concise, or rambling?',
];

const GENERATING_MESSAGES = [
  'Reviewing your evaluation history…',
  'Separating MCQ correctness from real depth-of-understanding…',
  'Identifying patterns across your answers…',
  'Building diagrams…',
  'Writing the analysis…',
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

function GeneratingReport() {
  const [messageIndex, setMessageIndex] = useState(0);

  useEffect(() => {
    const id = window.setInterval(() => {
      setMessageIndex((i) => (i + 1) % GENERATING_MESSAGES.length);
    }, 2200);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div style={styles.generating}>
      <div className="pl" style={{ fontSize: 6.5 }}>
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
      <p style={styles.generatingText}>{GENERATING_MESSAGES[messageIndex]}</p>
    </div>
  );
}

function ReportView({ report }: { report: Report }) {
  return (
    <div style={styles.report}>
      <div style={styles.summaryBanner}>{renderMarkdownLite(report.summary)}</div>

      {report.diagrams.length > 0 && (
        <div style={styles.diagramsGrid}>
          {report.diagrams.map((d, i) => (
            <div key={i} style={styles.diagramCard}>
              <DiagramChart diagram={d} />
            </div>
          ))}
        </div>
      )}

      <div style={styles.analysisGrid}>
        <div style={styles.analysisPanel}>
          <h3 style={styles.panelTitle}>Analysis</h3>
          {renderMarkdownLite(report.analysis)}
        </div>
        <div style={styles.analysisPanel}>
          <h3 style={styles.panelTitle}>Justification</h3>
          {renderMarkdownLite(report.justification)}
        </div>
        <div style={styles.analysisPanel}>
          <h3 style={styles.panelTitle}>Predictions</h3>
          {renderMarkdownLite(report.predictions)}
        </div>
      </div>
    </div>
  );
}

export default function EvaluationPage() {
  const navigate = useNavigate();
  const [authError, setAuthError] = useState(false);
  const [input, setInput] = useState('');
  const {
    reports,
    currentReport,
    loadingReports,
    loadingReport,
    generating,
    error,
    selectReport,
    generate,
  } = useDeepEvaluation();

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

  if (authError) {
    return <SessionExpired />;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const question = input.trim();
    if (!question || generating) return;
    setInput('');
    generate(question);
  }

  return (
    <div style={styles.page} className="show-cursor">
      <AppHeader />

      <div style={styles.body}>
        <aside style={styles.sidebar}>
          <p style={styles.sidebarTitle}>Past reports</p>
          {loadingReports ? (
            <p style={styles.meta}>Loading…</p>
          ) : reports.length === 0 ? (
            <p style={styles.meta}>No reports yet.</p>
          ) : (
            reports.map((r) => (
              <button
                key={r.id}
                style={{
                  ...styles.reportItem,
                  ...(currentReport?.id === r.id ? styles.reportItemActive : {}),
                }}
                onClick={() => selectReport(r.id)}
              >
                <span style={styles.reportItemQuestion}>{r.question_text}</span>
                <span style={styles.reportItemDate}>
                  {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
              </button>
            ))
          )}
        </aside>

        <main style={styles.main}>
          <div style={styles.headerBlock}>
            <h1 style={styles.title}>Deep Evaluation</h1>
            <p style={styles.subtitle}>
              Ask about your real, already-scored evaluation data — every report is grounded in your actual
              numbers, never guessed.
            </p>
          </div>

          <form onSubmit={handleSubmit} style={styles.inputRow}>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask about your evaluation…"
              style={styles.input}
              disabled={generating}
            />
            <button type="submit" style={styles.sendButton} disabled={generating || !input.trim()}>
              {generating ? 'Generating…' : 'Generate'}
            </button>
          </form>

          {error && <p style={styles.error}>{error}</p>}

          {generating ? (
            <GeneratingReport />
          ) : loadingReport ? (
            <p style={styles.meta}>Loading report…</p>
          ) : currentReport ? (
            <ReportView report={currentReport} />
          ) : (
            !loadingReports && (
              <div style={styles.emptyState}>
                <p style={styles.meta}>Nothing generated yet. Try:</p>
                <div style={styles.suggestions}>
                  {SUGGESTIONS.map((s) => (
                    <button key={s} style={styles.suggestionChip} onClick={() => generate(s)} disabled={generating}>
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </main>
      </div>
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
  body: {
    display: 'flex',
    alignItems: 'flex-start',
    minHeight: 'calc(100vh - 72px)',
  },
  sidebar: {
    width: 260,
    flexShrink: 0,
    borderRight: '1px solid var(--card-border)',
    padding: '20px 14px',
    boxSizing: 'border-box',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    position: 'sticky',
    top: 72,
    height: 'calc(100vh - 72px)',
    overflowY: 'auto',
  },
  sidebarTitle: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--text-meta)',
    margin: '0 8px 8px',
  },
  reportItem: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
    textAlign: 'left',
    background: 'none',
    border: 'none',
    borderRadius: 8,
    padding: '8px 8px',
    cursor: 'pointer',
    color: 'var(--text)',
  },
  reportItemActive: {
    background: 'var(--card-bg)',
  },
  reportItemQuestion: {
    fontSize: 12.5,
    lineHeight: 1.4,
    display: '-webkit-box',
    WebkitLineClamp: 2,
    WebkitBoxOrient: 'vertical',
    overflow: 'hidden',
  },
  reportItemDate: {
    fontSize: 10.5,
    color: 'var(--text-meta)',
  },
  main: {
    flex: 1,
    minWidth: 0,
    padding: '32px 40px 64px',
    boxSizing: 'border-box',
  },
  headerBlock: {
    marginBottom: 20,
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
  inputRow: {
    display: 'flex',
    gap: 8,
    marginBottom: 24,
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
    whiteSpace: 'nowrap',
  },
  meta: {
    fontSize: 13,
    color: 'var(--text-meta)',
    margin: 0,
  },
  error: {
    fontSize: 13,
    color: '#ec4b4b',
    margin: '0 0 16px',
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
  generating: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 20,
    padding: '64px 0',
  },
  generatingText: {
    fontSize: 14,
    fontFamily: "'Poppins', sans-serif",
    fontWeight: 600,
    color: 'var(--text-secondary)',
    margin: 0,
  },
  report: {
    display: 'flex',
    flexDirection: 'column',
    gap: 28,
  },
  summaryBanner: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 14,
    padding: '18px 22px',
    color: 'var(--text)',
    fontSize: 15,
    lineHeight: 1.6,
  },
  diagramsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
    gap: 20,
  },
  diagramCard: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 14,
    padding: '14px 16px',
  },
  analysisGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
    gap: 20,
  },
  analysisPanel: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 14,
    padding: '18px 20px',
    color: 'var(--text)',
    fontSize: 14,
    lineHeight: 1.6,
  },
  panelTitle: {
    fontSize: 13,
    fontWeight: 700,
    letterSpacing: '0.02em',
    textTransform: 'uppercase',
    color: 'var(--text-meta)',
    margin: '0 0 10px',
  },
};
