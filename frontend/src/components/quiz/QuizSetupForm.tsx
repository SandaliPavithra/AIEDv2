import { useState, FormEvent } from 'react';
import type { Difficulty, QuestionType, Topic } from '../../hooks/useQuizSession';

interface QuizSetupFormProps {
  topics: Topic[];
  error: string | null;
  onSubmit: (params: {
    topic_id: string;
    difficulty: Difficulty;
    question_type: QuestionType;
    total_questions: number;
  }) => void;
}

export default function QuizSetupForm({ topics, error, onSubmit }: QuizSetupFormProps) {
  const [topicId, setTopicId] = useState('');
  const [difficulty, setDifficulty] = useState<Difficulty>('medium');
  const [questionType, setQuestionType] = useState<QuestionType>('mixed');
  const [totalQuestions, setTotalQuestions] = useState(5);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!topicId) return;
    onSubmit({ topic_id: topicId, difficulty, question_type: questionType, total_questions: totalQuestions });
  }

  return (
    <form style={s.card} onSubmit={handleSubmit}>
      <h1 style={s.title}>Start a quiz</h1>
      <p style={s.subtitle}>Answer questions generated from the course material. No feedback until the whole quiz is done.</p>

      <label style={s.label}>Topic</label>
      <select style={s.input} value={topicId} onChange={(e) => setTopicId(e.target.value)} required>
        <option value="" disabled>Select a topic</option>
        {topics.map((t) => (
          <option key={t.id} value={t.id}>{t.name}</option>
        ))}
      </select>

      <label style={s.label}>Difficulty</label>
      <select style={s.input} value={difficulty} onChange={(e) => setDifficulty(e.target.value as Difficulty)}>
        <option value="easy">Easy</option>
        <option value="medium">Medium</option>
        <option value="hard">Hard</option>
        <option value="mixed">Mixed</option>
      </select>

      <label style={s.label}>Question type</label>
      <select style={s.input} value={questionType} onChange={(e) => setQuestionType(e.target.value as QuestionType)}>
        <option value="mixed">Mixed</option>
        <option value="mcq">Multiple choice</option>
        <option value="short_answer">Short answer</option>
        <option value="long_answer">Long answer</option>
      </select>

      <label style={s.label}>Number of questions</label>
      <input
        style={s.input}
        type="number"
        min={1}
        max={20}
        value={totalQuestions}
        onChange={(e) => setTotalQuestions(Math.max(1, Math.min(20, Number(e.target.value) || 1)))}
      />

      {error && <p style={s.error}>{error}</p>}

      <button style={s.btn} type="submit" disabled={!topicId}>
        Start quiz
      </button>
    </form>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 24,
    padding: '40px 36px',
    width: 420,
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    color: 'var(--text)',
  },
  title: { fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em', margin: '0 0 4px', color: 'var(--text)' },
  subtitle: { fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 12px' },
  label: { fontSize: 13, color: 'var(--text-meta)', marginTop: 4 },
  input: {
    padding: '10px 12px',
    borderRadius: 8,
    border: '1px solid var(--card-border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 14,
    outline: 'none',
  },
  btn: {
    marginTop: 16,
    padding: '12px',
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
  error: { color: '#f87171', fontSize: 13, margin: '4px 0 0' },
};
