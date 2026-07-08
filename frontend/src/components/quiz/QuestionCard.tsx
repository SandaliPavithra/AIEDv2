import { useEffect, useState } from 'react';
import type { Question } from '../../hooks/useQuizSession';

interface QuestionCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  submitting: boolean;
  error: string | null;
  onSubmit: (answerText: string) => void;
  onTextInteraction: () => void;
  onOptionSelect: () => void;
  onOptionHoverStart: () => void;
  onOptionHoverEnd: () => void;
}

export default function QuestionCard({
  question,
  questionNumber,
  totalQuestions,
  submitting,
  error,
  onSubmit,
  onTextInteraction,
  onOptionSelect,
  onOptionHoverStart,
  onOptionHoverEnd,
}: QuestionCardProps) {
  const [answerText, setAnswerText] = useState('');
  const [selectedOption, setSelectedOption] = useState<number | null>(null);

  // Reset local answer state when a new question arrives.
  useEffect(() => {
    setAnswerText('');
    setSelectedOption(null);
  }, [question.id]);

  const isMcq = question.question_type === 'mcq' && !!question.options;
  const canSubmit = isMcq ? selectedOption !== null : answerText.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    const value = isMcq ? question.options![selectedOption!] : answerText;
    onSubmit(value);
  }

  function selectOption(index: number) {
    if (index === selectedOption) return;
    setSelectedOption(index);
    onOptionSelect();
  }

  const citation = [question.citation_book, question.citation_chapter].filter(Boolean).join(' — ');

  return (
    <div style={s.card}>
      <div style={s.progress}>Question {questionNumber} of {totalQuestions}</div>
      <p style={s.questionText}>{question.question_text}</p>
      {citation && <p style={s.citation}>{citation}</p>}

      {isMcq ? (
        <div style={s.options}>
          {question.options!.map((opt, i) => (
            <label
              key={i}
              style={{ ...s.option, ...(selectedOption === i ? s.optionSelected : {}) }}
              onMouseEnter={onOptionHoverStart}
              onMouseLeave={onOptionHoverEnd}
            >
              <input
                type="radio"
                name="mcq-option"
                checked={selectedOption === i}
                onChange={() => selectOption(i)}
                style={{ marginRight: 10 }}
              />
              {opt}
            </label>
          ))}
        </div>
      ) : (
        <textarea
          style={s.textarea}
          value={answerText}
          onChange={(e) => {
            setAnswerText(e.target.value);
            onTextInteraction();
          }}
          placeholder="Type your answer…"
          rows={question.question_type === 'long_answer' ? 8 : 3}
        />
      )}

      {error && <p style={s.error}>{error}</p>}

      <button style={s.btn} onClick={handleSubmit} disabled={!canSubmit || submitting}>
        {submitting ? 'Submitting…' : questionNumber === totalQuestions ? 'Finish quiz' : 'Next question'}
      </button>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--card-bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 24,
    padding: '40px 36px',
    width: 560,
    maxWidth: '90vw',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    color: 'var(--text)',
  },
  progress: { fontSize: 12, color: 'var(--text-meta)', fontWeight: 600, letterSpacing: '0.02em' },
  questionText: { fontSize: 18, fontWeight: 600, margin: 0, lineHeight: 1.5, color: 'var(--text)' },
  citation: { fontSize: 12, color: 'var(--text-note)', margin: 0, fontStyle: 'italic' },
  options: { display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  option: {
    display: 'flex',
    alignItems: 'center',
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--card-border)',
    fontSize: 14,
    cursor: 'pointer',
    color: 'var(--text)',
  },
  optionSelected: {
    borderColor: 'var(--text)',
    background: 'var(--header-bg)',
  },
  textarea: {
    padding: '12px 14px',
    borderRadius: 10,
    border: '1px solid var(--card-border)',
    background: 'var(--bg)',
    color: 'var(--text)',
    fontSize: 14,
    fontFamily: 'inherit',
    resize: 'vertical',
    outline: 'none',
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  btn: {
    marginTop: 8,
    padding: '12px',
    background: 'var(--text)',
    color: 'var(--bg)',
    border: 'none',
    borderRadius: 8,
    fontWeight: 700,
    fontSize: 14,
    cursor: 'pointer',
  },
};
