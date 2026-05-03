import type { ChartPayload } from '@shared/api-types.js';
import { DonutChart } from './DonutChart.js';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';

export function ChartCard({ title, payload }: { title: string; payload: ChartPayload }) {
  return (
    <div className="bg-surface border border-border rounded-lg p-4">
      <div className="text-xs uppercase tracking-wider font-semibold text-text-muted mb-3">{title}</div>
      {payload.type === 'donut' && <DonutChart series={payload.series} />}
      {payload.type === 'bar' &&   <BarChart data={payload.series} xKey={payload.xKey} yKey={payload.yKey} />}
      {payload.type === 'line' &&  <LineChart data={payload.series} xKey={payload.xKey} yKey={payload.yKey} />}
    </div>
  );
}
