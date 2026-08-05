import { useCallback, useEffect, useState } from 'react';

export interface DiagramSeries {
  name: string;
  values: number[];
}

export interface Diagram {
  kind: 'line' | 'bar' | 'radar';
  title: string;
  x_labels: string[];
  series: DiagramSeries[];
}

export interface ReportSummary {
  id: string;
  question_text: string;
  summary: string;
  created_at: string;
}

export interface Report extends ReportSummary {
  analysis: string;
  justification: string;
  predictions: string;
  diagrams: Diagram[];
}

function apiUrl(path: string) {
  return `${import.meta.env.VITE_API_URL}${path}`;
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = localStorage.getItem('access_token');
  const res = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers ?? {}),
    },
  });
  const data = res.status === 204 ? null : await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.detail ? String(data.detail) : `Request failed (${res.status})`);
  return data;
}

export function useDeepEvaluation() {
  const [reports, setReports] = useState<ReportSummary[]>([]);
  const [currentReport, setCurrentReport] = useState<Report | null>(null);
  const [loadingReports, setLoadingReports] = useState(true);
  const [loadingReport, setLoadingReport] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadReports = useCallback(async () => {
    try {
      const rows: ReportSummary[] = await apiFetch('/deep-evaluation/reports');
      setReports(rows);
      return rows;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load report history.');
      return [];
    }
  }, []);

  const selectReport = useCallback(async (id: string) => {
    setError(null);
    setLoadingReport(true);
    try {
      const report: Report = await apiFetch(`/deep-evaluation/reports/${id}`);
      setCurrentReport(report);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load that report.');
    } finally {
      setLoadingReport(false);
    }
  }, []);

  // Auto-open the most recent report on page visit, so returning to this page
  // shows the last thing you generated instead of an empty state every time.
  useEffect(() => {
    loadReports()
      .then((rows) => {
        if (rows.length > 0) return selectReport(rows[0].id);
      })
      .finally(() => setLoadingReports(false));
  }, [loadReports, selectReport]);

  const generate = useCallback(async (question: string) => {
    setError(null);
    setGenerating(true);
    try {
      const report: Report = await apiFetch('/deep-evaluation/generate', {
        method: 'POST',
        body: JSON.stringify({ question }),
      });
      setCurrentReport(report);
      setReports((prev) => [
        { id: report.id, question_text: report.question_text, summary: report.summary, created_at: report.created_at },
        ...prev,
      ]);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate a report. Try again.');
    } finally {
      setGenerating(false);
    }
  }, []);

  return {
    reports,
    currentReport,
    loadingReports,
    loadingReport,
    generating,
    error,
    selectReport,
    generate,
  };
}
