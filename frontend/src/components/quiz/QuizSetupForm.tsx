import { useState, FormEvent } from 'react';
import type { Difficulty, QuestionType, Topic } from '../../hooks/useQuizSession';
import Dropdown from './Dropdown';

interface QuizSetupFormProps {
  topics: Topic[];
  error: string | null;
  onSubmit: (params: {
    topic_ids: string[];
    difficulty: Difficulty;
    question_type: QuestionType;
    total_questions: number;
  }) => void;
}

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'mixed', label: 'Mixed' },
];

const QUESTION_CATEGORY_OPTIONS = [
  { value: 'mixed', label: 'Mixed' },
  { value: 'mcq', label: 'Multiple choice' },
  { value: 'short_answer', label: 'Short answer' },
  { value: 'long_answer', label: 'Long answer' },
];

export default function QuizSetupForm({ topics, error, onSubmit }: QuizSetupFormProps) {
  const [topicIds, setTopicIds] = useState<string[]>([]);
  const [difficulty, setDifficulty] = useState<string[]>([]);
  const [questionType, setQuestionType] = useState<string[]>([]);
  const [totalQuestions, setTotalQuestions] = useState('');

  const canSubmit = topicIds.length > 0 && difficulty.length > 0 && questionType.length > 0 && totalQuestions !== '';

  function handleTotalQuestionsChange(raw: string) {
    if (raw === '') {
      setTotalQuestions('');
      return;
    }
    setTotalQuestions(String(Math.max(1, Math.min(20, Number(raw) || 1))));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    onSubmit({
      topic_ids: topicIds,
      difficulty: difficulty[0] as Difficulty,
      question_type: questionType[0] as QuestionType,
      total_questions: Number(totalQuestions),
    });
  }

  return (
    <form style={s.card} onSubmit={handleSubmit}>
      <h1 style={s.title}>Generate Quiz</h1>
      <p style={s.subtitle}>
        Pick your topics, difficulty, and question mix — we'll pull a fresh quiz from the course material.
      </p>

      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Select Topic:</label>
        <Dropdown
          placeholder="You can select multiple topics!"
          options={topics.map((t) => ({ value: t.id, label: t.name }))}
          selected={topicIds}
          onChange={setTopicIds}
          multi
        />
      </div>

      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Select Difficulty:</label>
        <Dropdown
          placeholder="Select a suitable difficulty"
          options={DIFFICULTY_OPTIONS}
          selected={difficulty}
          onChange={setDifficulty}
        />
      </div>

      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Select Question Category:</label>
        <Dropdown
          placeholder="Select a question type"
          options={QUESTION_CATEGORY_OPTIONS}
          selected={questionType}
          onChange={setQuestionType}
        />
      </div>

      <div style={s.fieldRow}>
        <label style={s.fieldLabel}>Select Number of Questions:</label>
        <div className="signin-field" style={s.numberField}>
          <input
            className="signin-input"
            style={s.numberInput}
            type="number"
            min={1}
            max={20}
            placeholder="More questions, better evaluation!"
            value={totalQuestions}
            onChange={(e) => handleTotalQuestionsChange(e.target.value)}
          />
        </div>
      </div>

      {error && <p style={s.error}>{error}</p>}

      <button className="glow-btn" type="submit" disabled={!canSubmit} style={s.btnWrap}>
        <span className="glow-btn__ring" aria-hidden="true" />
        <span className="glow-btn__face">Generate Quiz</span>
      </button>
    </form>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    display: 'flex',
    flexDirection: 'column',
    gap: 22,
    width: 560,
    color: 'var(--text)',
  },
  title: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: '2.25rem',
    fontWeight: 600,
    letterSpacing: '-0.01em',
    margin: 0,
    color: 'var(--text)',
  },
  subtitle: {
    fontFamily: "'Poppins', sans-serif",
    fontWeight: 200,
    fontSize: 15,
    lineHeight: 1.5,
    color: 'var(--text-secondary)',
    margin: '0 0 8px',
  },
  fieldRow: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 14,
  },
  fieldLabel: {
    color: 'var(--text)',
    fontFamily: "'Poppins', sans-serif",
    fontSize: 13,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
    whiteSpace: 'nowrap',
  },
  numberField: {
    flex: 1,
    minWidth: 0,
    borderBottom: '1px solid var(--card-border)',
  },
  numberInput: {
    width: '100%',
    border: 'none',
    background: 'transparent',
    outline: 'none',
    padding: '4px 2px',
    boxSizing: 'border-box',
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  btnWrap: { marginTop: 12, width: 220, alignSelf: 'flex-end' },
};
