import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuizSession } from '../hooks/useQuizSession';
import QuizSetupForm from '../components/quiz/QuizSetupForm';
import GeneratingScreen from '../components/quiz/GeneratingScreen';
import QuestionCard from '../components/quiz/QuestionCard';
import QuizComplete from '../components/quiz/QuizComplete';

export default function GenerationPage() {
  const navigate = useNavigate();
  const [isDark, setIsDark] = useState(() => localStorage.getItem('theme') !== 'light');

  const {
    phase,
    error,
    topics,
    currentQuestion,
    questionNumber,
    totalQuestions,
    submitting,
    startSession,
    retryGenerating,
    submitAnswer,
    restart,
    recordTextInteraction,
    recordOptionSelect,
    recordOptionHoverStart,
    recordOptionHoverEnd,
  } = useQuizSession();

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    localStorage.setItem('theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    if (!localStorage.getItem('access_token')) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  return (
    <div style={s.page} className="show-cursor">
      <header style={s.header}>
        <span style={s.headerTitle}>Question Generation</span>
        <div style={s.headerActions}>
          <button
            className="theme-toggle"
            onClick={() => setIsDark((d) => !d)}
            aria-label="Toggle light / dark mode"
          >
            <span className="toggle-orb" />
          </button>
          <button style={s.backBtn} onClick={() => navigate('/dashboard')}>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main style={s.main}>
        {phase === 'setup' && (
          <QuizSetupForm topics={topics} error={error} onSubmit={startSession} />
        )}
        {phase === 'generating' && (
          <GeneratingScreen error={error} onRetry={retryGenerating} />
        )}
        {phase === 'quiz' && currentQuestion && (
          <QuestionCard
            question={currentQuestion}
            questionNumber={questionNumber}
            totalQuestions={totalQuestions}
            submitting={submitting}
            error={error}
            onSubmit={submitAnswer}
            onTextInteraction={recordTextInteraction}
            onOptionSelect={recordOptionSelect}
            onOptionHoverStart={recordOptionHoverStart}
            onOptionHoverEnd={recordOptionHoverEnd}
          />
        )}
        {phase === 'complete' && <QuizComplete onRestart={restart} />}
      </main>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--bg)',
    fontFamily: 'sans-serif',
    transition: 'background 0.35s ease',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 32px',
    height: 64,
    background: 'var(--header-bg)',
    borderBottom: '1px solid var(--header-border)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    transition: 'background 0.35s ease, border-color 0.35s ease',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.03em',
    color: 'var(--text)',
    transition: 'color 0.35s ease',
  },
  headerActions: { display: 'flex', alignItems: 'center', gap: 12 },
  backBtn: {
    padding: '8px 20px',
    background: 'transparent',
    color: 'var(--btn-text)',
    border: '1px solid var(--btn-border)',
    borderRadius: 8,
    fontWeight: 600,
    cursor: 'pointer',
    fontSize: 14,
    transition: 'color 0.35s ease, border-color 0.35s ease',
  },
  main: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(100vh - 64px)',
    padding: '32px 16px',
  },
};
