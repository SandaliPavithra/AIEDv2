import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ThemeToggle from './ThemeToggle';

export default function AppHeader() {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  function handleLogout() {
    localStorage.removeItem('access_token');
    navigate('/login', { replace: true });
  }

  return (
    <header style={s.header}>
      <div style={s.headerActions}>
        <ThemeToggle />
        <div style={s.profileWrap} ref={menuRef}>
          <button
            style={s.profileCircle}
            onClick={() => setMenuOpen((o) => !o)}
            aria-label="Account menu"
            aria-expanded={menuOpen}
          />
          {menuOpen && (
            <div style={s.profileMenu}>
              <button style={s.profileMenuItem} onClick={() => setMenuOpen(false)}>
                View account
              </button>
              <div style={s.profileMenuDivider} />
              <button style={s.profileMenuItem} onClick={handleLogout}>
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

const s: Record<string, React.CSSProperties> = {
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'flex-end',
    padding: '0 32px',
    height: 72,
    background: 'var(--bg)',
    position: 'sticky',
    top: 0,
    zIndex: 100,
    transition: 'background 0.35s ease',
  },
  headerActions: {
    display: 'flex',
    alignItems: 'center',
    gap: 16,
  },
  profileWrap: {
    position: 'relative',
  },
  profileCircle: {
    width: 36,
    height: 36,
    borderRadius: '50%',
    background: 'var(--text)',
    border: 'none',
    padding: 0,
    cursor: 'pointer',
  },
  profileMenu: {
    position: 'absolute',
    top: 'calc(100% + 10px)',
    right: 0,
    minWidth: 160,
    background: 'var(--bg)',
    border: '1px solid var(--card-border)',
    borderRadius: 10,
    boxShadow: '0 8px 24px rgba(0, 0, 0, 0.18)',
    overflow: 'hidden',
    zIndex: 200,
  },
  profileMenuItem: {
    display: 'block',
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
  profileMenuDivider: {
    height: 1,
    background: 'var(--card-border)',
  },
};
