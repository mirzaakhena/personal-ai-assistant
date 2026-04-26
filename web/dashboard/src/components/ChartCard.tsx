// web/dashboard/src/components/ChartCard.tsx

import type { ChartPayload } from '@shared/api-types.js';
import { DonutChart } from './DonutChart.js';
import { BarChart } from './BarChart.js';
import { LineChart } from './LineChart.js';

export function ChartCard({ title, payload }: { title: string; payload: ChartPayload }) {
  return (
    <div className="bg-white border rounded p-4">
      <div className="font-medium mb-2">{title}</div>
      {payload.type === 'donut' && <DonutChart series={payload.series} />}
      {payload.type === 'bar' &&   <BarChart data={payload.series} xKey={payload.xKey} yKey={payload.yKey} />}
      {payload.type === 'line' &&  <LineChart data={payload.series} xKey={payload.xKey} yKey={payload.yKey} />}
    </div>
  );
}
