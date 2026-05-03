import { BarChart as RBar, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export function BarChart({ data, xKey, yKey }: {
  data: Array<Record<string, number | string>>;
  xKey: string; yKey: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <RBar data={data}>
        <CartesianGrid stroke="#262b33" strokeDasharray="3 3" />
        <XAxis dataKey={xKey} stroke="#9aa3b2" fontSize={12} />
        <YAxis stroke="#9aa3b2" fontSize={12} />
        <Tooltip contentStyle={{ background: '#14171c', border: '1px solid #3a4150', color: '#e6e8eb' }} />
        <Bar dataKey={yKey} fill="#7aa2ff" />
      </RBar>
    </ResponsiveContainer>
  );
}
