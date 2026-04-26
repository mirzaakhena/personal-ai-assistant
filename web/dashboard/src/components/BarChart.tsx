// web/dashboard/src/components/BarChart.tsx

import { BarChart as RBar, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function BarChart({ data, xKey, yKey }: {
  data: Array<Record<string, number | string>>;
  xKey: string; yKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RBar data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Bar dataKey={yKey} fill="#0ea5e9" />
      </RBar>
    </ResponsiveContainer>
  );
}
