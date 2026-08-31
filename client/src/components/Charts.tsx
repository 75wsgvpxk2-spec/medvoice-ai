/**
 * Four small SVG chart primitives.
 *
 * There is no chart library here and there should not be: the whole interface
 * is hand-written CSS with no component library (`docs/STACK.md`), and a
 * dependency that ships its own theming, its own tooltips and its own idea of
 * typography would look like a different product bolted on.
 *
 * All four take plain numbers, colour themselves from the CSS custom properties
 * the rest of the app uses, and render nothing rather than a broken axis when
 * there is no data. Money arrives in integer cents and is formatted by the
 * caller — nothing here does arithmetic on currency.
 */

import type { ReactNode } from 'react';

/** Series colours, in the order a chart consumes them. */
const SERIES = [
  'var(--brand)',
  'var(--watch)',
  'var(--managed)',
  'var(--critical)',
  'var(--stable)',
  'var(--brand-deep)',
];

function Empty({ label }: { label: string }) {
  return (
    <div className="chart-empty" role="status">
      {label}
    </div>
  );
}

/** Shared frame: a titled box that keeps every chart the same size. */
export function ChartCard({
  title,
  aside,
  children,
}: {
  title: string;
  aside?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="card stack chart-card">
      <div className="spread">
        <h3>{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * A trend over time. Points are evenly spaced by index rather than by date —
 * the series comes from a GROUP BY month, so the gaps are already uniform.
 */
export function LineChart({
  points,
  format,
}: {
  points: Array<{ label: string; value: number }>;
  format: (n: number) => string;
}) {
  if (points.length === 0) return <Empty label="Nothing in this period yet." />;

  const w = 560;
  const h = 200;
  const pad = { top: 12, right: 12, bottom: 26, left: 56 };
  const max = Math.max(...points.map((p) => p.value), 1);
  const innerW = w - pad.left - pad.right;
  const innerH = h - pad.top - pad.bottom;

  // A single point has no width to spread across; put it in the middle rather
  // than dividing by zero and rendering a NaN path.
  const x = (i: number) =>
    pad.left + (points.length === 1 ? innerW / 2 : (i / (points.length - 1)) * innerW);
  const y = (v: number) => pad.top + innerH - (v / max) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ');
  const area = `${path} L ${x(points.length - 1)} ${pad.top + innerH} L ${x(0)} ${pad.top + innerH} Z`;

  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="chart" role="img" aria-label="Trend over time">
      {[0, 0.5, 1].map((t) => (
        <g key={t}>
          <line
            x1={pad.left} x2={w - pad.right}
            y1={pad.top + innerH * t} y2={pad.top + innerH * t}
            stroke="var(--line)" strokeDasharray="3 3"
          />
          <text x={pad.left - 8} y={pad.top + innerH * t + 4} textAnchor="end" className="chart-tick">
            {format(max * (1 - t))}
          </text>
        </g>
      ))}
      <path d={area} fill="var(--brand)" opacity="0.10" />
      <path d={path} fill="none" stroke="var(--brand)" strokeWidth="2.5" strokeLinejoin="round" />
      {points.map((p, i) => (
        <circle key={p.label} cx={x(i)} cy={y(p.value)} r="3.5" fill="var(--brand)">
          <title>{`${p.label}: ${format(p.value)}`}</title>
        </circle>
      ))}
      {points.map((p, i) =>
        // Every label on a twelve-month axis overlaps, so only every other one
        // is drawn once the series gets long.
        points.length > 6 && i % 2 === 1 ? null : (
          <text key={`l-${p.label}`} x={x(i)} y={h - 8} textAnchor="middle" className="chart-tick">
            {p.label}
          </text>
        ),
      )}
    </svg>
  );
}

/** Composition of a total. Renders as a ring so the centre can hold the total. */
export function DonutChart({
  slices,
  total,
  centreLabel,
}: {
  slices: Array<{ label: string; value: number }>;
  total: string;
  centreLabel: string;
}) {
  const sum = slices.reduce((a, s) => a + s.value, 0);
  if (sum === 0) return <Empty label="Nothing recorded in this period." />;

  const size = 200;
  const r = 78;
  const stroke = 26;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="donut-wrap">
      <svg viewBox={`0 0 ${size} ${size}`} className="chart donut" role="img" aria-label="Breakdown by category">
        <g transform={`translate(${size / 2} ${size / 2}) rotate(-90)`}>
          {slices.map((s, i) => {
            const share = s.value / sum;
            const dash = share * circumference;
            const el = (
              <circle
                key={s.label}
                r={r} fill="none"
                stroke={SERIES[i % SERIES.length]}
                strokeWidth={stroke}
                strokeDasharray={`${dash} ${circumference - dash}`}
                strokeDashoffset={-offset}
              >
                <title>{`${s.label}: ${Math.round(share * 100)}%`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
        </g>
        <text x={size / 2} y={size / 2 - 2} textAnchor="middle" className="donut-total">{total}</text>
        <text x={size / 2} y={size / 2 + 16} textAnchor="middle" className="chart-tick">{centreLabel}</text>
      </svg>
      <ul className="chart-legend">
        {slices.map((s, i) => (
          <li key={s.label}>
            <span className="swatch" style={{ background: SERIES[i % SERIES.length] }} aria-hidden="true" />
            {s.label}
            <span className="legend-value">{Math.round((s.value / sum) * 100)}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Ranked comparison. Horizontal because the labels are words, not dates. */
export function BarChart({
  bars,
  format,
}: {
  bars: Array<{ label: string; value: number }>;
  format: (n: number) => string;
}) {
  if (bars.length === 0) return <Empty label="Nothing to compare yet." />;
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <ul className="bars">
      {bars.map((b, i) => (
        <li key={b.label}>
          <span className="bar-label" title={b.label}>{b.label}</span>
          <span className="bar-track">
            <span
              className="bar-fill"
              style={{
                // A small non-zero value still gets a visible sliver, but zero
                // gets nothing at all — drawing a bar for zero states a
                // quantity that is not there.
                width: b.value === 0 ? '0%' : `${Math.max(2, (b.value / max) * 100)}%`,
                background: SERIES[i % SERIES.length],
              }}
            />
          </span>
          <span className="bar-value tabular">{format(b.value)}</span>
        </li>
      ))}
    </ul>
  );
}
