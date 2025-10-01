/**
 * TypeScript 类型定义
 */

// API 响应基础类型
export interface ApiResponse<T = any> {
    success: boolean;
    data?: T;
    message?: string;
    error?: string;
}

// 用户统计类型
export interface UserStats {
    rank: number;
    username: string;
    user_id: number;
    requests: number;
    quota: number;
    success_requests: number;
    failed_requests: number;
}

export interface UserRankingResponse {
    success: boolean;
    period: 'day' | 'week' | 'month';
    metric: 'requests' | 'quota';
    count: number;
    ranking: UserStats[];
}

// 模型统计类型
export interface ModelStats {
    rank: number;
    model_name: string;
    total_requests: number;
    success_requests: number;
    failed_requests: number;
    success_rate: number;
    total_quota: number;
    total_tokens: number;
    prompt_tokens: number;
    completion_tokens: number;
}

export interface ModelStatsResponse {
    success: boolean;
    period: 'day' | 'week' | 'month';
    count: number;
    models: ModelStats[];
}

// Token 统计类型
export interface TokenConsumptionTotal {
    period: string;
    total_requests: number;
    total_prompt_tokens: number;
    total_completion_tokens: number;
    total_tokens: number;
    total_quota: number;
    start_time: string;
    end_time: string;
}

export interface TokenConsumptionByUser {
    username: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    requests: number;
    quota: number;
}

export interface TokenConsumptionByModel {
    model_name: string;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    requests: number;
    quota: number;
}

export type TokenConsumptionResponse =
    | ({ success: true } & TokenConsumptionTotal)
    | {
        success: true;
        period: string;
        group_by: 'user' | 'model';
        data: TokenConsumptionByUser[] | TokenConsumptionByModel[];
    };

// 趋势数据类型
export interface DailyTrendData {
    date: string;
    requests: number;
    quota: number;
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
    success_requests: number;
    failed_requests: number;
    success_rate: number;
}

export interface DailyTrendResponse {
    success: boolean;
    days: number;
    data: DailyTrendData[];
}

// 总览数据类型
export interface OverviewPeriodStats {
    requests: number;
    quota: number;
    tokens: number;
}

export interface OverviewResponse {
    success: boolean;
    today: OverviewPeriodStats;
    week: OverviewPeriodStats;
    month: OverviewPeriodStats;
    top_users: UserStats[];
    top_models: ModelStats[];
}

// 兑换码类型
export interface RedemptionItem {
    name: string;
    key: string;
    quota: number;
    result: any;
}

export interface BatchRedemptionRequest {
    count: number;
    quota_type: 'fixed' | 'random';
    fixed_quota?: number;
    min_quota?: number;
    max_quota?: number;
    expired_time?: number;
    name_prefix?: string;
}

export interface BatchRedemptionResponse {
    success: boolean;
    total: number;
    created: number;
    failed: number;
    redemptions: RedemptionItem[];
    errors?: Array<{ index: number; error: string }>;
}

// Chart 数据类型
export interface QuotaTrendData {
    date: string;
    quota: number;
}

export interface ChartData {
    labels: string[];
    data: number[];
}

