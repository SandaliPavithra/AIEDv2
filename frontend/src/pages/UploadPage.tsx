import { useEffect, useRef, useState, FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from '../components/ThemeToggle';

interface Topic {
  id: string;
  name: string;
}

interface DocumentRow {
  id: string;
  title: string;
  author: string;
  document_type: string;
  difficulty: string;
  total_pages: number | null;
  total_chunks: number | null;
  ingestion_status: 'pending' | 'processing' | 'complete' | 'failed';
  uploaded_at: string;
  topic_id: string | null;
}

interface User {
  id: string;
  display_name: string;
  role: string;
}

const POLL_INTERVAL_MS = 3000;

function apiUrl(path: string) {
  return `${import.meta.env.VITE_API_URL}${path}`;
}

function authHeaders() {
  return { Authorization: `Bearer ${localStorage.getItem('access_token')}` };
}

export default function UploadPage() {
  const navigate = useNavigate();
  const [user, setUser] = useState<User | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [documents, setDocuments] = useState<DocumentRow[]>([]);

  const [title, setTitle] = useState('');
  const [author, setAuthor] = useState('');
  const [documentType, setDocumentType] = useState('textbook');
  const [difficulty, setDifficulty] = useState('medium');
  const [topicId, setTopicId] = useState('');
  const [file, setFile] = useState<File | null>(null);

  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeUploadId, setActiveUploadId] = useState<string | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [retryError, setRetryError] = useState<string | null>(null);

  const pollTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!localStorage.getItem('access_token')) {
      navigate('/login', { replace: true });
      return;
    }
    fetch(apiUrl('/auth/me'), { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setUser)
      .catch(() => navigate('/login', { replace: true }));

    fetch(apiUrl('/topics/'), { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : []))
      .then(setTopics)
      .catch(() => setTopics([]));
  }, [navigate]);

  function refreshHistory() {
    fetch(apiUrl('/documents/admin'), { headers: authHeaders() })
      .then((res) => (res.ok ? res.json() : Promise.reject()))
      .then(setDocuments)
      .catch(() => {});
  }

  useEffect(() => {
    if (user?.role === 'admin') refreshHistory();
  }, [user]);

  // Poll the just-uploaded document until ingestion finishes.
  useEffect(() => {
    if (!activeUploadId) return;

    const tick = async () => {
      try {
        const res = await fetch(apiUrl(`/documents/${activeUploadId}`), { headers: authHeaders() });
        if (!res.ok) throw new Error('Failed to check status');
        const doc: DocumentRow = await res.json();
        setDocuments((prev) => {
          const others = prev.filter((d) => d.id !== doc.id);
          return [doc, ...others];
        });
        if (doc.ingestion_status === 'complete' || doc.ingestion_status === 'failed') {
          setActiveUploadId(null);
          return;
        }
        pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      } catch {
        pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      }
    };

    tick();
    return () => {
      if (pollTimerRef.current) window.clearTimeout(pollTimerRef.current);
    };
  }, [activeUploadId]);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!file) return;
    setError(null);
    setUploading(true);

    try {
      const form = new FormData();
      form.append('title', title);
      form.append('author', author);
      form.append('document_type', documentType);
      form.append('difficulty', difficulty);
      if (topicId) form.append('topic_id', topicId);
      form.append('file', file);

      const res = await fetch(apiUrl('/documents/'), {
        method: 'POST',
        headers: authHeaders(),
        body: form,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ? String(data.detail) : 'Upload failed');

      setTitle('');
      setAuthor('');
      setTopicId('');
      setFile(null);
      setActiveUploadId(data.id);
      setDocuments((prev) => [data, ...prev.filter((d) => d.id !== data.id)]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  async function handleRetry(docId: string) {
    setRetryError(null);
    setRetryingId(docId);
    try {
      const res = await fetch(apiUrl(`/documents/${docId}/retry`), {
        method: 'POST',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.detail ? String(data.detail) : 'Retry failed');
      setDocuments((prev) => [data, ...prev.filter((d) => d.id !== data.id)]);
      setActiveUploadId(docId);
    } catch (err) {
      setRetryError(err instanceof Error ? err.message : 'Retry failed');
    } finally {
      setRetryingId(null);
    }
  }

  if (user && user.role !== 'admin') {
    return (
      <div style={s.page} className="show-cursor">
        <div style={s.centered}>
          <p style={{ color: 'var(--text)' }}>
            This page is admin-only.{' '}
            <button style={s.link} onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
          </p>
        </div>
      </div>
    );
  }

  return (
    <div style={s.page} className="show-cursor">
      <header style={s.header}>
        <span style={s.headerTitle}>Upload Textbook</span>
        <div style={s.headerActions}>
          <ThemeToggle />
          <button style={s.backBtn} onClick={() => navigate('/dashboard')}>Back to Dashboard</button>
        </div>
      </header>

      <main style={s.main}>
        <form style={s.card} onSubmit={handleSubmit}>
          <h1 style={s.title}>Add a book</h1>
          <p style={s.subtitle}>
            Uploads the PDF to storage, then extracts text, chunks it, and generates embeddings in the
            background. Large textbooks can take several minutes to finish processing — you can navigate
            away and check back.
          </p>

          <label style={s.label}>Title</label>
          <input style={s.input} value={title} onChange={(e) => setTitle(e.target.value)} required />

          <label style={s.label}>Author</label>
          <input style={s.input} value={author} onChange={(e) => setAuthor(e.target.value)} required />

          <label style={s.label}>Type</label>
          <select style={s.input} value={documentType} onChange={(e) => setDocumentType(e.target.value)}>
            <option value="textbook">Textbook</option>
            <option value="past_paper">Past paper</option>
            <option value="notes">Notes</option>
          </select>

          <label style={s.label}>Difficulty</label>
          <select style={s.input} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
            <option value="easy">Easy</option>
            <option value="medium">Medium</option>
            <option value="hard">Hard</option>
          </select>

          <label style={s.label}>Topic (optional)</label>
          <select style={s.input} value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">No topic</option>
            {topics.map((t) => (
              <option key={t.id} value={t.id}>{t.name}</option>
            ))}
          </select>

          <label style={s.label}>PDF file</label>
          <input
            style={s.input}
            type="file"
            accept="application/pdf"
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            required
          />

          {error && <p style={s.error}>{error}</p>}

          <button style={s.btn} type="submit" disabled={uploading || !file}>
            {uploading ? 'Uploading…' : 'Upload & start processing'}
          </button>
        </form>

        <div style={s.card}>
          <div style={s.historyHeader}>
            <h2 style={s.historyTitle}>Uploaded books</h2>
            <button style={s.refreshBtn} onClick={refreshHistory}>Refresh</button>
          </div>
          {retryError && <p style={s.error}>{retryError}</p>}
          {documents.length === 0 ? (
            <p style={s.subtitle}>No documents uploaded yet.</p>
          ) : (
            <div style={s.historyList}>
              {documents.map((d) => (
                <div key={d.id} style={s.historyRow}>
                  <div>
                    <p style={s.historyRowTitle}>{d.title}</p>
                    <p style={s.historyRowMeta}>
                      {d.author} &nbsp;·&nbsp; {d.document_type} &nbsp;·&nbsp; {d.difficulty}
                      {d.total_chunks != null && ` · ${d.total_chunks} chunks`}
                    </p>
                  </div>
                  <div style={s.historyRowActions}>
                    {d.ingestion_status === 'failed' && (
                      <button
                        style={s.retryBtn}
                        onClick={() => handleRetry(d.id)}
                        disabled={retryingId === d.id}
                      >
                        {retryingId === d.id ? 'Retrying…' : 'Retry'}
                      </button>
                    )}
                    <span style={{ ...s.statusBadge, ...statusStyles[d.ingestion_status] }}>
                      {d.ingestion_status}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

const statusStyles: Record<string, React.CSSProperties> = {
  pending: { color: '#fbbf24', borderColor: '#fbbf24' },
  processing: { color: '#60a5fa', borderColor: '#60a5fa' },
  complete: { color: '#4ade80', borderColor: '#4ade80' },
  failed: { color: '#f87171', borderColor: '#f87171' },
};

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: 'var(--bg)', fontFamily: 'sans-serif', transition: 'background 0.35s ease' },
  centered: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' },
  header: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 32px', height: 64,
    background: 'var(--header-bg)', borderBottom: '1px solid var(--header-border)', position: 'sticky', top: 0, zIndex: 100,
  },
  headerTitle: { fontSize: 18, fontWeight: 700, letterSpacing: '-0.03em', color: 'var(--text)' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 12 },
  backBtn: {
    padding: '8px 20px', background: 'transparent', color: 'var(--btn-text)', border: '1px solid var(--btn-border)',
    borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 14,
  },
  main: {
    display: 'flex', flexWrap: 'wrap', gap: 24, justifyContent: 'center', alignItems: 'flex-start',
    padding: '48px 16px',
  },
  card: {
    background: 'var(--card-bg)', border: '1px solid var(--card-border)', borderRadius: 24, padding: '36px 32px',
    width: 420, display: 'flex', flexDirection: 'column', gap: 10, color: 'var(--text)',
  },
  title: { fontSize: 22, fontWeight: 800, letterSpacing: '-0.03em', margin: 0, color: 'var(--text)' },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 8px', lineHeight: 1.5 },
  label: { fontSize: 13, color: 'var(--text-meta)', marginTop: 4 },
  input: {
    padding: '10px 12px', borderRadius: 8, border: '1px solid var(--card-border)', background: 'var(--bg)',
    color: 'var(--text)', fontSize: 14, outline: 'none',
  },
  btn: {
    marginTop: 16, padding: '12px', background: 'var(--text)', color: 'var(--bg)', border: 'none', borderRadius: 8,
    fontWeight: 700, fontSize: 14, cursor: 'pointer',
  },
  error: { color: '#f87171', fontSize: 13, margin: '4px 0 0' },
  historyHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  historyTitle: { fontSize: 18, fontWeight: 700, margin: 0, color: 'var(--text)' },
  refreshBtn: {
    padding: '6px 14px', background: 'transparent', color: 'var(--btn-text)', border: '1px solid var(--btn-border)',
    borderRadius: 8, fontWeight: 600, cursor: 'pointer', fontSize: 12,
  },
  historyList: { display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 },
  historyRow: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '10px 12px',
    borderRadius: 10, border: '1px solid var(--card-border)',
  },
  historyRowTitle: { fontSize: 14, fontWeight: 600, margin: 0, color: 'var(--text)' },
  historyRowMeta: { fontSize: 12, color: 'var(--text-meta)', margin: '2px 0 0' },
  historyRowActions: { display: 'flex', alignItems: 'center', gap: 8 },
  retryBtn: {
    padding: '4px 12px', background: 'transparent', color: 'var(--btn-text)', border: '1px solid var(--btn-border)',
    borderRadius: 999, fontWeight: 600, cursor: 'pointer', fontSize: 11,
  },
  statusBadge: {
    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', padding: '4px 10px', borderRadius: 999,
    border: '1px solid', whiteSpace: 'nowrap',
  },
  link: { background: 'none', border: 'none', color: 'var(--text)', cursor: 'pointer', fontWeight: 600, textDecoration: 'underline', padding: 0 },
};
