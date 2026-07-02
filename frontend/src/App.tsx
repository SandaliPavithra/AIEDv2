import { useNavigate } from 'react-router-dom';

export default function App() {
  const navigate = useNavigate();

  return (
    <div style={{ minHeight: '100vh', background: '#000', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <main style={{ textAlign: 'center', padding: '0 32px', maxWidth: 768 }}>
        <h1 style={{ color: '#fff', fontWeight: 700, fontSize: '2.5rem', lineHeight: 1.3, marginBottom: 48, fontFamily: 'sans-serif' }}>
          Artificial Intelligence in Education for Evaluation, Recommendation and Generation
        </h1>
        <button
          onClick={() => navigate('/login')}
          style={{ background: '#fff', color: '#000', border: 'none', borderRadius: 9999, padding: '14px 40px', fontWeight: 600, fontSize: 16, cursor: 'pointer' }}
        >
          Log in
        </button>
      </main>
    </div>
  );
}
