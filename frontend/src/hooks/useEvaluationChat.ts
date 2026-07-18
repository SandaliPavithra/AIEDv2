import { useCallback, useEffect, useState } from 'react';

export interface ChatChartSeries {
  name: string;
  values: number[];
}

export interface ChatChart {
  kind: 'line' | 'bar';
  title: string;
  x_labels: string[];
  series: ChatChartSeries[];
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
  chart?: ChatChart | null;
}

function apiUrl(path: string) {
  return `${import.meta.env.VITE_API_URL}${path}`;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('access_token');
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail ? String(data.detail) : `Request failed (${res.status})`);
  return data;
}

export function useEvaluationChat() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loadingHistory, setLoadingHistory] = useState(true);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    apiFetch('/evaluation-chat/history')
      .then((rows: ChatMessage[]) => setMessages(rows))
      .catch((err) => setError(err instanceof Error ? err.message : 'Failed to load history.'))
      .finally(() => setLoadingHistory(false));
  }, []);

  const sendMessage = useCallback(async (content: string) => {
    setError(null);
    setMessages((prev) => [...prev, { role: 'user', content }]);
    setSending(true);
    try {
      const reply: ChatMessage = await apiFetch('/evaluation-chat/chat', {
        method: 'POST',
        body: JSON.stringify({ content }),
      });
      setMessages((prev) => [...prev, reply]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to get a response. Try again.');
    } finally {
      setSending(false);
    }
  }, []);

  return { messages, loadingHistory, sending, error, sendMessage };
}
