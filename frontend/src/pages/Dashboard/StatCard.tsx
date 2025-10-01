/**
 * 统计卡片组件 - TypeScript 版本
 */
import React from 'react';
import { Card, CardContent, Typography, Box, Avatar } from '@mui/material';

interface StatCardProps {
    title: string;
    value: string | number;
    icon: React.ReactElement;
    color: string;
    trend?: string;
}

const StatCard: React.FC<StatCardProps> = ({
    title,
    value,
    icon,
    color,
    trend
}) => {
    return (
        <Card
            sx={{
                height: '100%',
                transition: 'transform 0.2s, box-shadow 0.2s',
                '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: 4,
                },
            }}
        >
            <CardContent>
                <Box
                    display="flex"
                    justifyContent="space-between"
                    alignItems="flex-start"
                >
                    <Box>
                        <Typography variant="body2" color="text.secondary" gutterBottom>
                            {title}
                        </Typography>
                        <Typography variant="h4" component="div" sx={{ mb: 1 }}>
                            {value}
                        </Typography>
                        {trend && (
                            <Typography variant="body2" color="primary">
                                {trend}
                            </Typography>
                        )}
                    </Box>
                    <Avatar
                        sx={{
                            bgcolor: color,
                            width: 56,
                            height: 56,
                        }}
                    >
                        {icon}
                    </Avatar>
                </Box>
            </CardContent>
        </Card>
    );
};

export default StatCard;

