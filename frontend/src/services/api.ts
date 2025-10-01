/**
 * API 服务层 - TypeScript 版本
 */
import axios, { AxiosInstance, AxiosError } from 'axios';
import {
    UserRankingResponse,
    ModelStatsResponse,
    TokenConsumptionResponse,
    DailyTrendResponse,
    OverviewResponse,
    BatchRedemptionRequest,
    BatchRedemptionResponse,
} from '../types';

// 创建 axios 实例
const apiClient: AxiosInstance = axios.create({
    baseURL: import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000',
    timeout: 30000,
    headers: {
        'Content-Type': 'application/json',
    },
});

// 请求拦截器
apiClient.interceptors.request.use(
    (config) => {
        const token = localStorage.getItem('access_token');
        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        }
        return config;
    },
    (error: AxiosError) => {
        return Promise.reject(error);
    }
);

// 响应拦截器
apiClient.interceptors.response.use(
    (response) => response.data,
    (error: AxiosError) => {
        if (error.response?.status === 401) {
            localStorage.removeItem('access_token');
            window.location.href = '/login';
        }
        return Promise.reject(error);
    }
);

// 统计 API
export const statsAPI = {
    /**
     * 获取用户排行榜
     */
    getUserRanking: (
        metric: 'requests' | 'quota' = 'requests',
        period: 'day' | 'week' | 'month' = 'week',
        limit: number = 10
    ): Promise<UserRankingResponse> => {
        return apiClient.get('/api/v1/stats/user-ranking', {
            params: { metric, period, limit },
        });
    },

    /**
     * 获取模型统计
     */
    getModelStats: (
        period: 'day' | 'week' | 'month' = 'day'
    ): Promise<ModelStatsResponse> => {
        return apiClient.get('/api/v1/stats/model-stats', {
            params: { period },
        });
    },

    /**
     * 获取 Token 消耗统计
     */
    getTokenConsumption: (
        period: 'day' | 'week' | 'month' = 'week',
        group_by: 'total' | 'user' | 'model' = 'total'
    ): Promise<TokenConsumptionResponse> => {
        return apiClient.get('/api/v1/stats/token-consumption', {
            params: { period, group_by },
        });
    },

    /**
     * 获取每日趋势
     */
    getDailyTrend: (days: number = 7): Promise<DailyTrendResponse> => {
        return apiClient.get('/api/v1/stats/daily-trend', {
            params: { days },
        });
    },

    /**
     * 获取总览数据
     */
    getOverview: (): Promise<OverviewResponse> => {
        return apiClient.get('/api/v1/stats/overview');
    },
};

// 兑换码 API
export const redemptionAPI = {
    /**
     * 批量创建兑换码
     */
    createBatch: (
        data: BatchRedemptionRequest
    ): Promise<BatchRedemptionResponse> => {
        return apiClient.post('/api/v1/redemption/batch', data);
    },

    /**
     * 获取兑换码列表
     */
    getList: (page: number = 1, page_size: number = 50): Promise<any> => {
        return apiClient.get('/api/v1/redemption/list', {
            params: { page, page_size },
        });
    },
};

export default apiClient;

