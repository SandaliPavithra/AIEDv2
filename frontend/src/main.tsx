import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.tsx';
import LoginPage from './pages/LoginPage.tsx';
import SignupPage from './pages/SignupPage.tsx';
import CallbackPage from './pages/CallbackPage.tsx';
import DashboardPage from './pages/DashboardPage.tsx';
import GenerationPage from './pages/GenerationPage.tsx';
import UploadPage from './pages/UploadPage.tsx';
import EvaluationPage from './pages/EvaluationPage.tsx';
import AppShell from './components/AppShell.tsx';
import { ThemeProvider } from './contexts/ThemeContext.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <BrowserRouter>
        <AppShell>
          <Routes>
            <Route path="/" element={<App />} />
            <Route path="/login" element={<LoginPage />} />
            <Route path="/signup" element={<SignupPage />} />
            <Route path="/callback" element={<CallbackPage />} />
            <Route path="/dashboard" element={<DashboardPage />} />
            <Route path="/generate" element={<GenerationPage />} />
            <Route path="/upload" element={<UploadPage />} />
            <Route path="/evaluation" element={<EvaluationPage />} />
          </Routes>
        </AppShell>
      </BrowserRouter>
    </ThemeProvider>
  </StrictMode>,
);
