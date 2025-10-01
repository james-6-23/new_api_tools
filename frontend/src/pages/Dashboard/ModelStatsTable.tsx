/**
 * 模型统计表格组件 - TypeScript 版本
 */
import React, { useState, useEffect } from 'react';
import {
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    Paper,
    Chip,
    CircularProgress,
    Box,
    Alert,
} from '@mui/material';
import { statsAPI } from '../../services/api';
import { ModelStats } from '../../types';

const ModelStatsTable: React.FC = () => {
    const [loading, setLoading] = useState<boolean>(true);
    const [error, setError] = useState<string | null>(null);
    const [models, setModels] = useState<ModelStats[]>([]);

    useEffect(() => {
        loadModelStats();
    }, []);

    const loadModelStats = async (): Promise<void> => {
        try {
            setLoading(true);
            setError(null);
            const data = await statsAPI.getModelStats('day');
            setModels(data.models || []);
        } catch (err) {
            console.error('Failed to load model stats:', err);
            setError('加载模型统计失败');
        } finally {
            setLoading(false);
        }
    };

    // 格式化数字
    const formatNumber = (num: number): string => {
        return num.toLocaleString();
    };

    // 格式化大数字
    const formatLargeNumber = (num: number): string => {
        if (num >= 1000) {
            return `${(num / 1000).toFixed(1)}K`;
        }
        return formatNumber(num);
    };

    if (loading) {
        return (
            <Box display="flex" justifyContent="center" p={3}>
                <CircularProgress />
            </Box>
        );
    }

    if (error) {
        return (
            <Alert severity="error" sx={{ m: 2 }}>
                {error}
            </Alert>
        );
    }

    if (models.length === 0) {
        return (
            <Box p={3} textAlign="center" color="text.secondary">
                暂无数据
            </Box>
        );
    }

    return (
        <TableContainer component={Paper} variant="outlined">
            <Table>
                <TableHead>
                    <TableRow>
                        <TableCell>排名</TableCell>
                        <TableCell>模型名称</TableCell>
                        <TableCell align="right">请求次数</TableCell>
                        <TableCell align="right">配额使用</TableCell>
                        <TableCell align="right">成功率</TableCell>
                        <TableCell align="right">Token 数</TableCell>
                    </TableRow>
                </TableHead>
                <TableBody>
                    {models.map((model) => (
                        <TableRow key={model.model_name} hover>
                            <TableCell>{model.rank}</TableCell>
                            <TableCell>{model.model_name}</TableCell>
                            <TableCell align="right">
                                {formatNumber(model.total_requests)}
                            </TableCell>
                            <TableCell align="right">
                                {formatLargeNumber(model.total_quota)}
                            </TableCell>
                            <TableCell align="right">
                                <Chip
                                    label={`${model.success_rate}%`}
                                    color={model.success_rate >= 95 ? 'success' : 'warning'}
                                    size="small"
                                />
                            </TableCell>
                            <TableCell align="right">
                                {formatLargeNumber(model.total_tokens)}
                            </TableCell>
                        </TableRow>
                    ))}
                </TableBody>
            </Table>
        </TableContainer>
    );
};

export default ModelStatsTable;

