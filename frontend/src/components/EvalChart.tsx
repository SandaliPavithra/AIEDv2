import { useTheme } from '../contexts/ThemeContext';
import type { ChatChart } from '../hooks/useEvaluationChat';

// Validated categorical palette (dataviz skill's reference default) — fixed
// order, never cycled/reassigned. Light/dark pairs both pass the CVD +
// normal-vision + contrast checks (validate_palette.js), so a 2-3 series
// chart never relies on color alone to distinguish series (labels/legend do).
const SERIES_LIGHT = ['#2a78d6', '#008300', '#e87ba4', '#eda100'];
const SERIES_DARK = ['#3987e5', '#008300', '#d55181', '#c98500'];

const WIDTH = 480;
const HEIGHT = 220;
const PAD = { top: 16, right: 16, bottom: 28, left: 34 };
const PLOT_W = WIDTH - PAD.left - PAD.right;
const PLOT_H = HEIGHT - PAD.top - PAD.bottom;

export default function EvalChart({ chart }: { chart: ChatChart }) {
  const { isDark } = useTheme();
  const colors = isDark ? SERIES_DARK : SERIES_LIGHT;
  const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
  const inkDim = 'var(--text-meta)';

  const values = chart.series.flatMap((s) => s.values);
  const maxVal = Math.max(1, ...values);
  const minVal = Math.min(0, ...values);
  const range = maxVal - minVal || 1;

  const n = chart.x_labels.length;
  const xStep = n > 1 ? PLOT_W / (n - 1) : 0;
  const barGroupW = n > 0 ? PLOT_W / n : PLOT_W;

  const yFor = (v: number) => PAD.top + PLOT_H - ((v - minVal) / range) * PLOT_H;
  const xForLine = (i: number) => PAD.left + i * xStep;
  const gridValues = [minVal, minVal + range / 2, maxVal];

  return (
    <div style={{ marginTop: 8 }}>
      <p style={{ fontSize: 12.5, fontWeight: 600, margin: '0 0 6px', color: 'var(--text)' }}>{chart.title}</p>

      {chart.series.length > 1 && (
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 6 }}>
          {chart.series.map((s, i) => (
            <span key={s.name} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: inkDim }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: colors[i % colors.length], display: 'inline-block' }} />
              {s.name}
            </span>
          ))}
        </div>
      )}

      <svg viewBox={`0 0 ${WIDTH} ${HEIGHT}`} width="100%" style={{ maxWidth: WIDTH, display: 'block' }}>
        {gridValues.map((v, i) => (
          <g key={i}>
            <line x1={PAD.left} x2={WIDTH - PAD.right} y1={yFor(v)} y2={yFor(v)} stroke={gridColor} strokeWidth={1} />
            <text x={PAD.left - 6} y={yFor(v)} fill={inkDim} fontSize={10} textAnchor="end" dominantBaseline="middle">
              {Math.round(v)}
            </text>
          </g>
        ))}

        {chart.x_labels.map((label, i) => (
          <text
            key={label + i}
            x={chart.kind === 'line' ? xForLine(i) : PAD.left + barGroupW * (i + 0.5)}
            y={HEIGHT - 8}
            fill={inkDim}
            fontSize={10}
            textAnchor="middle"
          >
            {label.length > 10 ? `${label.slice(0, 9)}…` : label}
          </text>
        ))}

        {chart.kind === 'line'
          ? chart.series.map((s, si) => (
              <g key={s.name}>
                <polyline
                  points={s.values.map((v, i) => `${xForLine(i)},${yFor(v)}`).join(' ')}
                  fill="none"
                  stroke={colors[si % colors.length]}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {s.values.map((v, i) => (
                  <circle key={i} cx={xForLine(i)} cy={yFor(v)} r={3.5} fill={colors[si % colors.length]}>
                    <title>{`${chart.x_labels[i]}: ${s.name} = ${v}`}</title>
                  </circle>
                ))}
              </g>
            ))
          : chart.series.map((s, si) => {
              const barW = (barGroupW - 8) / chart.series.length;
              return s.values.map((v, i) => {
                const barH = PLOT_H - (yFor(v) - PAD.top);
                const x = PAD.left + barGroupW * i + 4 + barW * si;
                return (
                  <rect
                    key={`${si}-${i}`}
                    x={x}
                    y={yFor(v)}
                    width={Math.max(barW - 3, 1)}
                    height={Math.max(barH, 0)}
                    rx={3}
                    fill={colors[si % colors.length]}
                  >
                    <title>{`${chart.x_labels[i]}: ${s.name} = ${v}`}</title>
                  </rect>
                );
              });
            })}
      </svg>
    </div>
  );
}
