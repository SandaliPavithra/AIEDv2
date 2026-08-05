import { useEffect, useRef } from 'react';
import * as echarts from 'echarts';
import { useTheme } from '../contexts/ThemeContext';
import type { Diagram } from '../hooks/useDeepEvaluation';

// Same validated categorical palette as the old EvalChart (dataviz skill's
// reference default) — fixed order, never cycled/reassigned. Light/dark
// pairs both pass the CVD + normal-vision + contrast checks.
const SERIES_LIGHT = ['#2a78d6', '#008300', '#e87ba4', '#eda100'];
const SERIES_DARK = ['#3987e5', '#008300', '#d55181', '#c98500'];

function buildOption(diagram: Diagram, colors: string[], textColor: string, gridColor: string): echarts.EChartsOption {
  const base: echarts.EChartsOption = {
    color: colors,
    title: {
      text: diagram.title,
      textStyle: { fontSize: 13, fontWeight: 600, color: textColor },
      left: 0,
      top: 0,
    },
    textStyle: { fontFamily: "'Poppins', sans-serif", color: textColor },
    tooltip: { trigger: diagram.kind === 'radar' ? 'item' : 'axis' },
    legend: diagram.series.length > 1 ? { bottom: 0, textStyle: { color: textColor, fontSize: 11 } } : undefined,
    grid: { left: 36, right: 16, top: 40, bottom: diagram.series.length > 1 ? 32 : 16, containLabel: true },
  };

  if (diagram.kind === 'radar') {
    const allValues = diagram.series.flatMap((s) => s.values);
    const max = Math.max(10, ...allValues) * 1.15;
    return {
      ...base,
      radar: {
        indicator: diagram.x_labels.map((label) => ({ name: label, max })),
        axisName: { color: textColor, fontSize: 11 },
        splitLine: { lineStyle: { color: gridColor } },
        axisLine: { lineStyle: { color: gridColor } },
        splitArea: { show: false },
      },
      series: [
        {
          type: 'radar',
          data: diagram.series.map((s) => ({ name: s.name, value: s.values })),
        },
      ],
    };
  }

  const kind = diagram.kind; // narrowed to 'line' | 'bar' here (radar returned above)
  return {
    ...base,
    xAxis: {
      type: 'category',
      data: diagram.x_labels,
      axisLabel: { color: textColor, fontSize: 10 },
      axisLine: { lineStyle: { color: gridColor } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: textColor, fontSize: 10 },
      splitLine: { lineStyle: { color: gridColor } },
    },
    series: diagram.series.map((s) => ({
      name: s.name,
      type: kind,
      data: s.values,
      smooth: kind === 'line',
    })),
  };
}

export default function DiagramChart({ diagram }: { diagram: Diagram }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);
  const { isDark } = useTheme();

  useEffect(() => {
    if (!containerRef.current) return;
    const chart = echarts.init(containerRef.current);
    chartRef.current = chart;

    const onResize = () => chart.resize();
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('resize', onResize);
      chart.dispose();
      chartRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!chartRef.current) return;
    const colors = isDark ? SERIES_DARK : SERIES_LIGHT;
    const textColor = isDark ? 'rgba(255,255,255,0.75)' : 'rgba(0,0,0,0.75)';
    const gridColor = isDark ? 'rgba(255,255,255,0.12)' : 'rgba(0,0,0,0.12)';
    chartRef.current.setOption(buildOption(diagram, colors, textColor, gridColor), true);
  }, [diagram, isDark]);

  return <div ref={containerRef} style={{ width: '100%', height: 260 }} />;
}
