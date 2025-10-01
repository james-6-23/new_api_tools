/**
 * 配额趋势图表组件 - TypeScript 版本
 */
import React from 'react';
import {
    LineChart,
    Line,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    ResponsiveContainer,
    Legend,
    TooltipProps,
} from 'recharts';
import { useTheme } from '@mui/material/styles';
import { ChartData } from '../../types';

interface QuotaChartProps {
    data: ChartData;
}

interface ChartDataPoint {
    date: string;
    quota: number;
}

const QuotaChart: React.FC<QuotaChartProps> = ({ data }) => {
    const theme = useTheme();

    // 转换数据格式
    const chartData: ChartDataPoint[] = data.labels.map((label, index) => ({
        date: label,
        quota: data.data[index],
    }));

    // 格式化日期
    const formatDate = (value: string): string => {
        try {
            const date = new Date(value);
            return `${date.getMonth() + 1}/${date.getDate()}`;
        } catch {
            return value;
        }
    };

    // 格式化数值
    const formatValue = (value: number): string => {
        return `${(value / 1000).toFixed(0)}K`;
    };

    // 自定义 Tooltip
    const CustomTooltip: React.FC<TooltipProps<number, string>> = ({
        active,
        payload,
        label,
    }) => {
        if (active && payload && payload.length) {
            return (
                <div
                    style={{
                        backgroundColor: 'rgba(255, 255, 255, 0.95)',
                        padding: '10px',
                        border: `1px solid ${theme.palette.divider}`,
                        borderRadius: '4px',
                    }}
                >
                    <p style={{ margin: 0, fontSize: '14px' }}>
                        日期: {label}
                    </p>
                    <p style={{ margin: '5px 0 0', fontSize: '14px', color: theme.palette.primary.main }}>
                        配额: {payload[0].value?.toLocaleString()}
                    </p>
                </div>
            );
        }
        return null;
    };

    return (
        <ResponsiveContainer width="100%" height={300}>
            <LineChart
                data={chartData}
                margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
            >
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis
                    dataKey="date"
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatDate}
                />
                <YAxis
                    tick={{ fontSize: 12 }}
                    tickFormatter={formatValue}
                />
                <Tooltip content={<CustomTooltip />} />
                <Legend />
                <Line
                    type="monotone"
                    dataKey="quota"
                    stroke={theme.palette.primary.main}
                    strokeWidth={2}
                    dot={{ r: 4 }}
                    activeDot={{ r: 6 }}
                    name="配额使用"
                />
            </LineChart>
        </ResponsiveContainer>
    );
};

export default QuotaChart;

