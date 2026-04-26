// web/dashboard/src/components/LineChart.tsx

import { LineChart as RLine, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function LineChart({ data, xKey, yKey }: {
  data: Array<Record<string, number | string>>;
  xKey: string; yKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RLine data={data}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey={xKey} />
        <YAxis />
        <Tooltip />
        <Line dataKey={yKey} stroke="#0ea5e9" dot={false} />
      </RLine>
    </ResponsiveContainer>
  );
}
