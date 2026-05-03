import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer, Legend } from 'recharts';

const COLORS = ['#7aa2ff', '#4ade80', '#fbbf24', '#f87171', '#a78bfa', '#9aa3b2'];

export function DonutChart({ series }: {
  series: Array<{ name: string; value: number }>;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart>
        <Pie data={series} dataKey="value" nameKey="name" innerRadius={50} outerRadius={90}
             stroke="#14171c" strokeWidth={2}>
          {series.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip contentStyle={{ background: '#14171c', border: '1px solid #3a4150', color: '#e6e8eb' }} />
        <Legend wrapperStyle={{ color: '#9aa3b2', fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}
