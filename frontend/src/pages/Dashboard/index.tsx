/**
 * Dashboard 主页面 - TypeScript 版本
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
    Grid,
    Card,
    CardContent,
    Typography,
    Box,
    CircularProgress,
    Alert,
    AlertTitle,
} from '@mui/material';
import {
    TrendingUp,
    CheckCircle,
    Group,
    AttachMoney,
} from '@mui/icons-material';
import { statsAPI } from '../../services/api';
import { OverviewResponse, ChartData } from '../../types';
import StatCard from './StatCard';
import QuotaChart from './QuotaChart';
import ModelStatsTable from './ModelStatsTable';

const Dashboard: React.FC = () => {
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [overview, setOverview] = useState<OverviewResponse | null>(null);
    const [quotaTrend, setQuotaTrend] = useState<ChartData | null>(null);

    // 加载数据
    const loadDashboardData = useCallback(async () => {
        try {
            setLoading(true);
            setError(null);

            // 并行请求
            const [overviewData, trendData] = await Promise.all([
                statsAPI.getOverview(),
                statsAPI.getDailyTrend(7),
            ]);

            setOverview(overviewData);

            // 转换趋势数据格式
            if (trendData.success && trendData.data) {
                setQuotaTrend({
                    labels: trendData.data.map((item) => item.date),
                    data: trendData.data.map((item) => item.quota),
                });
            }
        } catch (err) {
            console.error('Failed to load dashboard data:', err);
            setError('加载数据失败，请检查后端服务是否启动或稍后重试');
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        loadDashboardData();
    }, [loadDashboardData]);

    // 格式化数字
    const formatNumber = (num: number): string => {
        return num.toLocaleString();
    };

    // 格式化大数字
    const formatLargeNumber = (num: number): string => {
        if (num >= 1000000) {
            return `${(num / 1000000).toFixed(2)}M`;
        }
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}K`;
        }
        return formatNumber(num);
    };

    if (loading) {
        return (
            <Box
                display="flex"
                justifyContent="center"
                alignItems="center"
                minHeight="400px"
            >
                <CircularProgress size={60} />
            </Box>
        );
    }

    if (error) {
        return (
            <Alert severity="error" sx={{ mb: 2 }}>
                <AlertTitle>错误</AlertTitle>
                {error}
            </Alert>
        );
    }

    if (!overview) {
        return (
            <Alert severity="warning" sx={{ mb: 2 }}>
                <AlertTitle>警告</AlertTitle>
                暂无数据
            </Alert>
        );
    }

    return (
        <Box>
            {/* 标题 */}
            <Typography variant="h4" gutterBottom>
                仪表盘
            </Typography>
            <Typography variant="body2" color="text.secondary" gutterBottom>
                实时监控 API 使用情况
            </Typography>

            {/* 统计卡片 */}
            <Grid container spacing={3} sx={{ mt: 2 }}>
                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="总请求数"
                        value={formatNumber(overview.today.requests)}
                        icon={<TrendingUp />}
                        color="#1976d2"
                        trend="+12.5%"
                    />
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="今日成功率"
                        value="95.5%"
                        icon={<CheckCircle />}
                        color="#2e7d32"
                        trend="+2.3%"
                    />
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="活跃用户"
                        value={overview.top_users.length.toString()}
                        icon={<Group />}
                        color="#ed6c02"
                        trend={`Top ${overview.top_users.length}`}
                    />
                </Grid>

                <Grid item xs={12} sm={6} md={3}>
                    <StatCard
                        title="总配额使用"
                        value={formatLargeNumber(overview.today.quota)}
                        icon={<AttachMoney />}
                        color="#9c27b0"
                        trend="+8.1%"
                    />
                </Grid>
            </Grid>

            {/* 配额趋势图表 */}
            <Grid container spacing={3} sx={{ mt: 1 }}>
                <Grid item xs={12} md={8}>
                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                配额使用趋势（7天）
                            </Typography>
                            {quotaTrend && <QuotaChart data={quotaTrend} />}
                        </CardContent>
                    </Card>
                </Grid>

                <Grid item xs={12} md={4}>
                    <Card sx={{ height: '100%' }}>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                统计总览
                            </Typography>
                            <Box sx={{ mt: 2 }}>
                                <Box sx={{ mb: 3 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        今日
                                    </Typography>
                                    <Typography variant="h5">
                                        {formatNumber(overview.today.requests)} 请求
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {formatLargeNumber(overview.today.quota)} 配额
                                    </Typography>
                                </Box>

                                <Box sx={{ mb: 3 }}>
                                    <Typography variant="body2" color="text.secondary">
                                        本周
                                    </Typography>
                                    <Typography variant="h5">
                                        {formatNumber(overview.week.requests)} 请求
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {formatLargeNumber(overview.week.quota)} 配额
                                    </Typography>
                                </Box>

                                <Box>
                                    <Typography variant="body2" color="text.secondary">
                                        本月
                                    </Typography>
                                    <Typography variant="h5">
                                        {formatNumber(overview.month.requests)} 请求
                                    </Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        {formatLargeNumber(overview.month.quota)} 配额
                                    </Typography>
                                </Box>
                            </Box>
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>

            {/* 模型使用统计 */}
            <Grid container spacing={3} sx={{ mt: 1 }}>
                <Grid item xs={12}>
                    <Card>
                        <CardContent>
                            <Typography variant="h6" gutterBottom>
                                模型使用排行
                            </Typography>
                            <ModelStatsTable />
                        </CardContent>
                    </Card>
                </Grid>
            </Grid>
        </Box>
    );
};

export default Dashboard;

