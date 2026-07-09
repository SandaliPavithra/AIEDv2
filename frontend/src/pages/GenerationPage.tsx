import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuizSession } from '../hooks/useQuizSession';
import AppHeader from '../components/AppHeader';
import QuizSetupForm from '../components/quiz/QuizSetupForm';
import GeneratingScreen from '../components/quiz/GeneratingScreen';
import QuestionCard from '../components/quiz/QuestionCard';
import QuizComplete from '../components/quiz/QuizComplete';

export default function GenerationPage() {
  const navigate = useNavigate();

  const {
    phase,
    error,
    topics,
    currentQuestion,
    questionNumber,
    totalQuestions,
    submitting,
    reveal,
    startSession,
    retryGenerating,
    submitAnswer,
    continueToNext,
    restart,
    recordTextInteraction,
    recordOptionSelect,
    recordOptionHoverStart,
    recordOptionHoverEnd,
  } = useQuizSession();

  useEffect(() => {
    if (!localStorage.getItem('access_token')) {
      navigate('/login', { replace: true });
    }
  }, [navigate]);

  return (
    <div style={s.page} className="show-cursor">
      <AppHeader />

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
            reveal={reveal}
            onSubmit={submitAnswer}
            onContinue={continueToNext}
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
    fontFamily: "'Poppins', sans-serif",
    transition: 'background 0.35s ease',
  },
  main: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 'calc(100vh - 72px)',
    padding: '32px 16px',
  },
};
