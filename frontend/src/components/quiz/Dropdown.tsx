import { useEffect, useRef, useState } from 'react';

export interface DropdownOption {
  value: string;
  label: string;
}

interface DropdownProps {
  placeholder: string;
  options: DropdownOption[];
  selected: string[];
  onChange: (values: string[]) => void;
  multi?: boolean;
}

export default function Dropdown({ placeholder, options, selected, onChange, multi = false }: DropdownProps) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleSelectOption(value: string) {
    if (multi) {
      onChange(selected.includes(value) ? selected.filter((v) => v !== value) : [...selected, value]);
    } else {
      onChange([value]);
      setOpen(false);
    }
  }

  function handleRemoveChip(value: string, e: React.MouseEvent) {
    e.stopPropagation();
    onChange(selected.filter((v) => v !== value));
  }

  function handleTriggerKeyDown(e: React.KeyboardEvent) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      setOpen((o) => !o);
    } else if (e.key === 'Escape') {
      setOpen(false);
    }
  }

  const selectedOptions = options.filter((o) => selected.includes(o.value));

  return (
    <div className="signin-field" style={s.field} ref={wrapRef}>
      <div
        role="button"
        tabIndex={0}
        style={s.trigger}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={handleTriggerKeyDown}
        aria-expanded={open}
      >
        {selectedOptions.length === 0 ? (
          <span style={s.placeholder}>{placeholder}</span>
        ) : multi ? (
          <div style={s.chipsRow}>
            {selectedOptions.map((o) => (
              <span key={o.value} style={s.chip}>
                {o.label}
                <button
                  type="button"
                  style={s.chipRemove}
                  onClick={(e) => handleRemoveChip(o.value, e)}
                  aria-label={`Remove ${o.label}`}
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : (
          <span style={s.value}>{selectedOptions[0].label}</span>
        )}

        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ ...s.chevron, transform: open ? 'rotate(180deg)' : 'none' }}
        >
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>

      {open && (
        <div style={s.menu}>
          {options.map((o) => {
            const isSelected = selected.includes(o.value);
            return (
              <button key={o.value} type="button" style={s.menuItem} onClick={() => handleSelectOption(o.value)}>
                <span>{o.label}</span>
                {isSelected && <span style={s.menuCheck}>✓</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  field: {
    position: 'relative',
    flex: 1,
    minWidth: 0,
    borderBottom: '1px solid var(--card-border)',
  },
  trigger: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    minHeight: 32,
    padding: '4px 2px',
    cursor: 'pointer',
    outline: 'none',
  },
  placeholder: {
    flex: 1,
    color: 'var(--text-note)',
    fontFamily: "'Poppins', sans-serif",
    fontWeight: 300,
    fontSize: 15,
  },
  value: {
    flex: 1,
    color: 'var(--text)',
    fontFamily: "'Poppins', sans-serif",
    fontWeight: 400,
    fontSize: 15,
  },
  chipsRow: {
    flex: 1,
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  chip: {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    background: 'var(--text)',
    color: 'var(--bg)',
    borderRadius: 999,
    padding: '4px 6px 4px 12px',
    fontFamily: "'Poppins', sans-serif",
    fontSize: 13,
    fontWeight: 500,
  },
  chipRemove: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    width: 16,
    height: 16,
    background: 'none',
    border: 'none',
    color: 'var(--bg)',
    fontSize: 14,
    lineHeight: 1,
    cursor: 'pointer',
    padding: 0,
    opacity: 0.75,
  },
  chevron: {
    flexShrink: 0,
    color: 'var(--text-note)',
    transition: 'transform 0.25s ease',
  },
  menu: {
    position: 'absolute',
    top: 'calc(100% + 10px)',
    left: 0,
    right: 0,
    maxHeight: 240,
    overflowY: 'auto',
    background: 'var(--bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    zIndex: 200,
  },
  menuItem: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    width: '100%',
    boxSizing: 'border-box',
    padding: '11px 16px',
    background: 'none',
    border: 'none',
    color: 'var(--text)',
    fontFamily: "'Poppins', sans-serif",
    fontSize: 13,
    fontWeight: 500,
    textAlign: 'left',
    cursor: 'pointer',
  },
  menuCheck: {
    color: 'var(--text-note)',
    fontSize: 12,
  },
};
