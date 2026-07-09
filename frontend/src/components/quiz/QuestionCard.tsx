import { useEffect, useState } from 'react';
import type { EvaluationResult, Question } from '../../hooks/useQuizSession';

interface QuestionCardProps {
  question: Question;
  questionNumber: number;
  totalQuestions: number;
  submitting: boolean;
  error: string | null;
  reveal: EvaluationResult | null;
  onSubmit: (answerText: string) => void;
  onContinue: () => void;
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
  reveal,
  onSubmit,
  onContinue,
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
  const isLongAnswer = question.question_type === 'long_answer';
  const answered = reveal !== null;
  const canSubmit = !answered && (isMcq ? selectedOption !== null : answerText.trim().length > 0);

  function handlePrimaryAction() {
    if (answered) {
      onContinue();
      return;
    }
    if (!canSubmit) return;
    const value = isMcq ? question.options![selectedOption!] : answerText;
    onSubmit(value);
  }

  function selectOption(index: number) {
    if (answered || index === selectedOption) return;
    setSelectedOption(index);
    onOptionSelect();
  }

  const citation = [question.citation_book, question.citation_chapter].filter(Boolean).join(' — ');

  let btnLabel: string;
  if (submitting) {
    btnLabel = answered ? 'Loading…' : 'Checking your answer…';
  } else if (answered) {
    btnLabel = questionNumber === totalQuestions ? 'Finish quiz' : 'Next question';
  } else {
    btnLabel = 'Submit answer';
  }

  return (
    <div style={s.layout}>
      <div style={s.left}>
        <div style={s.progress}>Question {questionNumber} of {totalQuestions}</div>
        <p style={s.questionText}>{question.question_text}</p>
        {citation && <p style={s.citation}>{citation}</p>}

        {isMcq ? (
          <div style={s.options}>
            {question.options!.map((opt, i) => (
              <label
                key={i}
                className={`mcq-option${selectedOption === i ? ' mcq-option--selected' : ''}${answered ? ' mcq-option--disabled' : ''}`}
                onMouseEnter={answered ? undefined : onOptionHoverStart}
                onMouseLeave={answered ? undefined : onOptionHoverEnd}
              >
                <input
                  type="radio"
                  name="mcq-option"
                  checked={selectedOption === i}
                  disabled={answered}
                  onChange={() => selectOption(i)}
                />
                {opt}
              </label>
            ))}
          </div>
        ) : isLongAnswer ? (
          <div className="long-answer-box">
            <textarea
              className="long-answer-textarea"
              value={answerText}
              disabled={answered}
              onChange={(e) => {
                setAnswerText(e.target.value);
                onTextInteraction();
              }}
              placeholder="Insert answer…"
              rows={8}
            />
          </div>
        ) : (
          <div className="signin-field" style={s.shortField}>
            <input
              className="signin-input"
              style={s.shortInput}
              type="text"
              value={answerText}
              disabled={answered}
              onChange={(e) => {
                setAnswerText(e.target.value);
                onTextInteraction();
              }}
              placeholder="Insert answer…"
            />
          </div>
        )}

        {error && <p style={s.error}>{error}</p>}

        <button
          className="glow-btn"
          style={s.btnWrap}
          onClick={handlePrimaryAction}
          disabled={(!answered && !canSubmit) || submitting}
        >
          <span className="glow-btn__ring" aria-hidden="true" />
          <span className="glow-btn__face">{btnLabel}</span>
        </button>
      </div>

      <div className={`eval-panel${answered ? ' eval-panel--active' : ''}`}>
        {reveal ? (
          <>
            <div className="eval-panel__ring" aria-hidden="true" />
            <div className="eval-panel__face">
              <span style={s.evalScore}>
                {Math.round(reveal.final_score)}
                <span style={s.evalScoreSuffix}>/100</span>
              </span>
              <p style={s.evalFeedback}>{reveal.feedback_text}</p>
            </div>
          </>
        ) : (
          <p style={s.evalPlaceholder}>The correct answer will appear here</p>
        )}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  layout: {
    display: 'flex',
    alignItems: 'stretch',
    gap: 64,
    width: 960,
    maxWidth: '94vw',
  },
  left: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 18,
    color: 'var(--text)',
  },
  progress: { fontSize: 12, color: 'var(--text-meta)', fontWeight: 600, letterSpacing: '0.02em' },
  questionText: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: 20,
    fontWeight: 700,
    margin: 0,
    lineHeight: 1.4,
    color: 'var(--text)',
  },
  citation: { fontSize: 12.5, color: 'var(--text-note)', margin: 0, fontStyle: 'italic' },
  options: { display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 },
  shortField: {
    borderBottom: '1px solid var(--card-border)',
  },
  shortInput: {
    width: '100%',
    padding: '10px 2px',
    fontSize: 16,
  },
  error: { color: '#f87171', fontSize: 13, margin: 0 },
  btnWrap: { marginTop: 8, width: 240, alignSelf: 'flex-end' },
  evalScore: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: 40,
    fontWeight: 700,
    color: 'var(--text)',
  },
  evalScoreSuffix: {
    fontSize: 16,
    fontWeight: 500,
    color: 'var(--text-note)',
  },
  evalFeedback: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: 14.5,
    lineHeight: 1.65,
    color: 'var(--text-secondary)',
    margin: 0,
    padding: '0 8px',
  },
  evalPlaceholder: {
    fontFamily: "'Poppins', sans-serif",
    fontSize: 13.5,
    color: 'var(--text-note)',
    textAlign: 'center',
    margin: 0,
    padding: '0 24px',
  },
};
