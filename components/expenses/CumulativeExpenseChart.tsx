'use client';

import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts';
import { formatCurrency } from '@/lib/utils';
import { ExpandableChart } from '@/components/charts/ExpandableChart';

interface CumulativeExpenseChartProps {
  data: Array<{
    date: string;
    cumulative: number;
    day: string;
  }>;
  budget?: number;
  title?: string;
}

export function CumulativeExpenseChart({ data, budget, title = 'Cumulative Spend' }: CumulativeExpenseChartProps) {
  return (
    <ExpandableChart title={title} height={256} expandedHeight={560} overlayButton>
      {() => (
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
            />
            <YAxis
              tick={{ fontSize: 12 }}
              stroke="#6b7280"
              tickFormatter={(value) => `₹${(value / 1000).toFixed(0)}k`}
            />
            <Tooltip
              formatter={(value: number) => formatCurrency(value)}
              labelFormatter={(label) => `Day ${label}`}
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
                padding: '8px 12px',
              }}
            />
            {budget && (
              <ReferenceLine
                y={budget}
                stroke="#ef4444"
                strokeDasharray="3 3"
                label={{ value: 'Budget', position: 'right', fill: '#ef4444', fontSize: 12 }}
              />
            )}
            <Line
              type="monotone"
              dataKey="cumulative"
              stroke="#10b981"
              strokeWidth={3}
              dot={{ fill: '#10b981', r: 4 }}
              activeDot={{ r: 6 }}
            />
          </LineChart>
        </ResponsiveContainer>
      )}
    </ExpandableChart>
  );
}
