import { ReactNode, useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import LiveLogSidebar, { PANEL_WIDTH } from './LiveLogSidebar';

export default function AppShell({ children }: { children: ReactNode }) {
  const location = useLocation();
  const [isAdmin, setIsAdmin] = useState(false);
  const [logOpen, setLogOpen] = useState(false);

  // Re-checks on every navigation (not just once) so logging in/out while
  // this shell stays mounted immediately shows/hides the toggle.
  useEffect(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      setIsAdmin(false);
      return;
    }
    fetch(`${import.meta.env.VITE_API_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((res) => (res.ok ? res.json() : null))
      .then((user) => setIsAdmin(user?.role === 'admin'))
      .catch(() => setIsAdmin(false));
  }, [location.pathname]);

  return (
    <>
      {isAdmin && <LiveLogSidebar open={logOpen} onToggle={() => setLogOpen((o) => !o)} />}
      <div
        style={{
          marginLeft: isAdmin && logOpen ? PANEL_WIDTH : 0,
          transition: 'margin-left 0.25s ease',
          minHeight: '100vh',
        }}
      >
        {children}
      </div>
    </>
  );
}
