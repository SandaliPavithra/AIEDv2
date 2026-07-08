import { useCallback, useEffect, useRef, useState } from 'react';

export type Difficulty = 'easy' | 'medium' | 'hard' | 'mixed';
export type QuestionType = 'short_answer' | 'long_answer' | 'mcq' | 'mixed';
export type Phase = 'setup' | 'generating' | 'quiz' | 'complete';

export interface Topic {
  id: string;
  name: string;
  slug: string;
  parent_id: string | null;
  level: number;
  description: string | null;
}

export interface Question {
  id: string;
  session_id: string;
  question_text: string;
  question_type: 'short_answer' | 'long_answer' | 'mcq';
  difficulty: string;
  options: string[] | null;
  expected_time_seconds: number;
  citation_book: string | null;
  citation_author: string | null;
  citation_chapter: string | null;
  citation_page_start: number | null;
  citation_page_end: number | null;
}

interface Session {
  id: string;
  total_questions: number;
}

const GENERATION_TIMEOUT_MS = 45_000;
const POLL_INTERVAL_MS = 2_000;
const MOUSE_ACTIVITY_THROTTLE_MS = 2_000;
const TEXT_EDIT_DEBOUNCE_MS = 800;

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

async function apiFetchWithRetry(path: string, options: RequestInit = {}) {
  try {
    return await apiFetch(path, options);
  } catch {
    return await apiFetch(path, options);
  }
}

export function useQuizSession() {
  const [phase, setPhase] = useState<Phase>('setup');
  const [error, setError] = useState<string | null>(null);
  const [topics, setTopics] = useState<Topic[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [submitting, setSubmitting] = useState(false);

  const eventsRef = useRef<{ event_type: string; event_at: string }[]>([]);
  const startedRef = useRef(false);
  const lastMouseEventRef = useRef(0);
  const editDebounceRef = useRef<number | null>(null);
  const pollTimerRef = useRef<number | null>(null);
  const pollDeadlineRef = useRef(0);
  const pollingRef = useRef(false);

  useEffect(() => {
    apiFetch('/topics/')
      .then((rows: Topic[]) => setTopics(rows))
      .catch(() => setTopics([]));
  }, []);

  const recordEvent = useCallback((event_type: string) => {
    eventsRef.current.push({ event_type, event_at: new Date().toISOString() });
  }, []);

  const recordFirstInteractionOrEdit = useCallback(() => {
    if (!startedRef.current) {
      startedRef.current = true;
      recordEvent('keystroke_start');
    } else {
      recordEvent('edit');
    }
  }, [recordEvent]);

  // Behavioural telemetry — active only while a question is on screen.
  useEffect(() => {
    if (phase !== 'quiz') return;
    eventsRef.current = [];
    startedRef.current = false;
    recordEvent('focus');

    function onFocus() {
      recordEvent('focus');
    }
    function onBlur() {
      recordEvent('blur');
    }
    function onMouseMove() {
      const now = Date.now();
      if (now - lastMouseEventRef.current < MOUSE_ACTIVITY_THROTTLE_MS) return;
      lastMouseEventRef.current = now;
      recordEvent('mouse_activity');
    }

    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    window.addEventListener('mousemove', onMouseMove);
    return () => {
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
      window.removeEventListener('mousemove', onMouseMove);
      if (editDebounceRef.current) window.clearTimeout(editDebounceRef.current);
    };
  }, [phase, currentIndex, recordEvent]);

  const recordTextInteraction = useCallback(() => {
    if (editDebounceRef.current) window.clearTimeout(editDebounceRef.current);
    editDebounceRef.current = window.setTimeout(recordFirstInteractionOrEdit, TEXT_EDIT_DEBOUNCE_MS);
  }, [recordFirstInteractionOrEdit]);

  const recordOptionSelect = useCallback(() => {
    recordFirstInteractionOrEdit();
  }, [recordFirstInteractionOrEdit]);

  const recordOptionHoverStart = useCallback(() => recordEvent('option_hover_start'), [recordEvent]);
  const recordOptionHoverEnd = useCallback(() => recordEvent('option_hover_end'), [recordEvent]);

  const stopPolling = useCallback(() => {
    pollingRef.current = false;
    if (pollTimerRef.current) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const pollQuestions = useCallback((sessionId: string, total: number) => {
    pollingRef.current = true;
    pollDeadlineRef.current = Date.now() + GENERATION_TIMEOUT_MS;

    const tick = async () => {
      if (!pollingRef.current) return;
      try {
        const rows: Question[] = await apiFetch(`/sessions/${sessionId}/questions`);
        if (rows.length >= total) {
          stopPolling();
          setQuestions(rows);
          setCurrentIndex(0);
          setPhase('quiz');
          return;
        }
        if (Date.now() > pollDeadlineRef.current) {
          stopPolling();
          setError('Question generation timed out. You can try again.');
          return;
        }
        pollTimerRef.current = window.setTimeout(tick, POLL_INTERVAL_MS);
      } catch (err) {
        stopPolling();
        setError(err instanceof Error ? err.message : 'Failed to check question generation status.');
      }
    };

    tick();
  }, [stopPolling]);

  useEffect(() => stopPolling, [stopPolling]);

  const startSession = useCallback(async (params: {
    topic_id: string;
    difficulty: Difficulty;
    question_type: QuestionType;
    total_questions: number;
  }) => {
    setError(null);
    try {
      const s: Session = await apiFetch('/sessions/', {
        method: 'POST',
        body: JSON.stringify(params),
      });
      setSession(s);
      setQuestions([]);
      setPhase('generating');
      pollQuestions(s.id, params.total_questions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session.');
    }
  }, [pollQuestions]);

  const retryGenerating = useCallback(() => {
    if (!session) return;
    setError(null);
    pollQuestions(session.id, session.total_questions);
  }, [session, pollQuestions]);

  const submitAnswer = useCallback(async (answerText: string) => {
    if (!session) return;
    const question = questions[currentIndex];
    if (!question) return;

    setSubmitting(true);
    setError(null);
    try {
      const answer = await apiFetchWithRetry('/answers/', {
        method: 'POST',
        body: JSON.stringify({
          question_id: question.id,
          session_id: session.id,
          answer_text: answerText,
        }),
      });

      await apiFetchWithRetry(`/answers/${answer.id}/events`, {
        method: 'POST',
        body: JSON.stringify({ events: eventsRef.current }),
      });

      if (currentIndex + 1 >= questions.length) {
        await apiFetchWithRetry(`/sessions/${session.id}/complete`, { method: 'POST' });
        setPhase('complete');
      } else {
        setCurrentIndex((i) => i + 1);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answer. Your answer has been kept — try again.');
    } finally {
      setSubmitting(false);
    }
  }, [session, questions, currentIndex]);

  const restart = useCallback(() => {
    setSession(null);
    setQuestions([]);
    setCurrentIndex(0);
    setError(null);
    setPhase('setup');
  }, []);

  return {
    phase,
    error,
    topics,
    currentQuestion: questions[currentIndex] ?? null,
    questionNumber: currentIndex + 1,
    totalQuestions: session?.total_questions ?? questions.length,
    submitting,
    startSession,
    retryGenerating,
    submitAnswer,
    restart,
    recordTextInteraction,
    recordOptionSelect,
    recordOptionHoverStart,
    recordOptionHoverEnd,
  };
}
