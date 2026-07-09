import { useTheme } from '../contexts/ThemeContext';

export default function ThemeToggle() {
  const { isDark, toggleTheme } = useTheme();

  return (
    <label className="toggle-switch">
      <input
        type="checkbox"
        className="toggle-input"
        checked={!isDark}
        onChange={toggleTheme}
        aria-label="Toggle light / dark mode"
      />
      <div className="toggle-track">
        <div className="toggle-rust" />
        <div className="toggle-glow" />
        <div className="toggle-icons">
          <svg className="icon-off" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
          <svg className="icon-on" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="4" />
            <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41" />
          </svg>
        </div>
        <div className="toggle-thumb">
          <div className="thumb-inner" />
          <div className="thumb-shine" />
        </div>
      </div>
      <div className="toggle-label">
        <span className="label-off">DARK</span>
        <span className="label-on">LIGHT</span>
      </div>
    </label>
  );
}
