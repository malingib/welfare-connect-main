import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { MonthlyContribution } from './types';

interface ContributionTrendChartProps {
  data: MonthlyContribution[];
  title?: string;
  description?: string;
}

export function ContributionTrendChart({ 
  data, 
  title = "Contribution Trends",
  description = "Monthly contributions over time"
}: ContributionTrendChartProps) {
  if (!data || data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-center text-muted-foreground py-8">No contribution data available</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-lg">
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        <ResponsiveContainer width="100%" height={350}>
          <AreaChart data={data} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="colorContribution" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#2563eb" stopOpacity={0.8} />
                <stop offset="95%" stopColor="#2563eb" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
            <XAxis 
              dataKey="month" 
              className="text-xs"
              tick={{ fontSize: 12 }}
              angle={-45}
              textAnchor="end"
              height={60}
            />
            <YAxis 
              className="text-xs"
              tick={{ fontSize: 12 }}
              tickFormatter={(value) => `KES ${value.toLocaleString()}`}
            />
            <Tooltip 
              contentStyle={{ 
                backgroundColor: 'hsl(var(--background))', 
                borderColor: 'hsl(var(--border))',
                borderRadius: '8px',
                boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)'
              }}
              formatter={(value: number) => [`KES ${value.toLocaleString()}`, 'Amount']}
              labelFormatter={(label) => `Period: ${label}`}
            />
            <Area 
              type="monotone" 
              dataKey="amount" 
              stroke="#2563eb" 
              strokeWidth={2}
              fillOpacity={1} 
              fill="url(#colorContribution)" 
              name="Contribution Amount"
            />
          </AreaChart>
        </ResponsiveContainer>
        <div className="mt-4 grid grid-cols-3 gap-4 text-center">
          <div className="text-sm">
            <p className="text-muted-foreground">Total Periods</p>
            <p className="text-2xl font-bold text-blue-600">{data.length}</p>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Total Amount</p>
            <p className="text-2xl font-bold text-green-600">KES {data.reduce((sum, d) => sum + d.amount, 0).toLocaleString()}</p>
          </div>
          <div className="text-sm">
            <p className="text-muted-foreground">Total Transactions</p>
            <p className="text-2xl font-bold text-primary">{data.reduce((sum, d) => sum + d.count, 0).toLocaleString()}</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
