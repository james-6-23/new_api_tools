# NewAPI 数据库结构文档

> 数据库类型：MySQL 8.2
> 数据库名：new-api
> 导出时间：2026-05-08
> 总表数：28 张

---

## 目录

1. [核心业务表](#核心业务表)
2. [用户相关表](#用户相关表)
3. [渠道与模型表](#渠道与模型表)
4. [日志与统计表](#日志与统计表)
5. [订阅与支付表](#订阅与支付表)
6. [任务与AI服务表](#任务与ai服务表)
7. [认证与安全表](#认证与安全表)
8. [系统配置表](#系统配置表)

---

## 核心业务表

### 1. users - 用户表
用户基础信息和账户数据

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| username | varchar(191) | 用户名，唯一索引 |
| password | longtext | 密码（加密） |
| display_name | varchar(191) | 显示名称 |
| role | bigint | 角色（1=普通用户） |
| status | bigint | 状态（1=正常） |
| email | varchar(191) | 邮箱 |
| quota | bigint | 可用额度 |
| used_quota | bigint | 已使用额度 |
| subscription_quota | bigint | 订阅额度 |
| request_count | bigint | 请求次数 |
| group | varchar(64) | 用户组（默认 default） |
| aff_code | varchar(32) | 邀请码，唯一 |
| aff_count | bigint | 邀请人数 |
| aff_quota | bigint | 邀请奖励额度 |
| aff_history | bigint | 历史邀请奖励 |
| inviter_id | bigint | 邀请人ID |
| access_token | char(32) | 访问令牌，唯一 |
| github_id | varchar(191) | GitHub 绑定ID |
| oidc_id | varchar(191) | OIDC 绑定ID |
| wechat_id | varchar(191) | 微信绑定ID |
| telegram_id | varchar(191) | Telegram 绑定ID |
| discord_id | varchar(191) | Discord 绑定ID |
| linux_do_id | varchar(191) | LinuxDo 绑定ID |
| idc_flare_id | varchar(191) | IDC Flare 绑定ID |
| stripe_customer | varchar(64) | Stripe 客户ID |
| setting | text | 用户设置（JSON） |
| remark | varchar(255) | 备注 |
| last_check_in_time | datetime(3) | 最后签到时间 |
| deleted_at | datetime(3) | 软删除时间 |

### 2. tokens - 令牌表
API 访问令牌管理

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 所属用户ID |
| key | char(48) | 令牌密钥，唯一 |
| status | bigint | 状态（1=正常） |
| name | varchar(191) | 令牌名称 |
| created_time | bigint | 创建时间 |
| accessed_time | bigint | 最后访问时间 |
| expired_time | bigint | 过期时间（-1=永不过期） |
| remain_quota | bigint | 剩余额度 |
| unlimited_quota | tinyint(1) | 是否无限额度 |
| used_quota | bigint | 已使用额度 |
| model_limits_enabled | tinyint(1) | 是否启用模型限制 |
| model_limits | text | 模型限制列表 |
| allow_ips | varchar(191) | IP 白名单 |
| group | varchar(191) | 令牌所属组 |
| rate_limit_enabled | tinyint(1) | 是否启用速率限制 |
| rate_limit_period | bigint | 速率限制周期（秒，默认60） |
| rate_limit_count | bigint | 周期内最大请求数（默认1000） |
| rate_limit_success | bigint | 成功请求限制（默认10） |
| cross_group_retry | tinyint(1) | 是否跨组重试 |
| deleted_at | datetime(3) | 软删除时间 |

### 3. redemptions - 兑换码表
额度兑换码管理

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 创建者用户ID |
| key | char(32) | 兑换码，唯一 |
| status | bigint | 状态（1=未使用） |
| name | varchar(191) | 兑换码名称 |
| quota | bigint | 兑换额度（默认100） |
| created_time | bigint | 创建时间 |
| redeemed_time | bigint | 兑换时间 |
| used_user_id | bigint | 使用者用户ID |
| expired_time | bigint | 过期时间 |
| valid_from | bigint | 生效开始时间 |
| valid_until | bigint | 生效结束时间 |
| is_gift | tinyint(1) | 是否为礼品码 |
| max_uses | bigint | 最大使用次数（-1=无限） |
| used_count | bigint | 已使用次数 |
| deleted_at | datetime(3) | 软删除时间 |

---

## 渠道与模型表

### 4. channels - 渠道表
AI 服务提供商渠道配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| type | bigint | 渠道类型（0=OpenAI等） |
| key | longtext | API 密钥 |
| name | varchar(191) | 渠道名称 |
| status | bigint | 状态（1=启用） |
| base_url | varchar(191) | API 基础URL |
| models | longtext | 支持的模型列表 |
| group | varchar(64) | 渠道分组（默认 default） |
| weight | bigint unsigned | 权重（负载均衡） |
| priority | bigint | 优先级 |
| balance | double | 余额 |
| balance_updated_time | bigint | 余额更新时间 |
| used_quota | bigint | 已使用额度 |
| test_model | longtext | 测试模型 |
| test_time | bigint | 测试时间 |
| response_time | bigint | 响应时间 |
| created_time | bigint | 创建时间 |
| open_ai_organization | longtext | OpenAI 组织ID |
| model_mapping | text | 模型映射配置 |
| status_code_mapping | varchar(1024) | 状态码映射 |
| auto_ban | bigint | 自动封禁（1=启用） |
| other | longtext | 其他配置 |
| other_info | longtext | 其他信息 |
| tag | varchar(191) | 标签 |
| setting | text | 设置 |
| param_override | text | 参数覆盖 |
| header_override | text | 请求头覆盖 |
| remark | varchar(255) | 备注 |
| channel_info | json | 渠道详细信息 |
| settings | longtext | 配置信息 |
| model_prefix | varchar(64) | 模型前缀 |
| system_prompt | text | 系统提示词 |

### 5. abilities - 能力表
渠道-模型-分组的能力映射关系

| 字段 | 类型 | 说明 |
|------|------|------|
| group | varchar(64) | 用户组，联合主键 |
| model | varchar(255) | 模型名称，联合主键 |
| channel_id | bigint | 渠道ID，联合主键 |
| enabled | tinyint(1) | 是否启用 |
| priority | bigint | 优先级 |
| weight | bigint unsigned | 权重 |
| tag | varchar(191) | 标签 |

### 6. models - 模型表
AI 模型信息管理

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| model_name | varchar(128) | 模型名称 |
| description | text | 模型描述 |
| icon | varchar(128) | 图标 |
| tags | varchar(255) | 标签 |
| vendor_id | bigint | 供应商ID |
| endpoints | text | 支持的端点 |
| status | bigint | 状态（1=启用） |
| sync_official | bigint | 同步官方（1=是） |
| name_rule | bigint | 命名规则 |
| created_time | bigint | 创建时间 |
| updated_time | bigint | 更新时间 |
| deleted_at | datetime(3) | 软删除时间 |

### 7. vendors - 供应商表
AI 服务供应商信息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| name | varchar(128) | 供应商名称 |
| description | text | 描述 |
| icon | varchar(128) | 图标 |
| status | bigint | 状态（1=启用） |
| created_time | bigint | 创建时间 |
| updated_time | bigint | 更新时间 |
| deleted_at | datetime(3) | 软删除时间 |

---

## 日志与统计表

### 8. logs - 请求日志表
API 请求详细日志

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| created_at | bigint | 创建时间 |
| type | bigint | 日志类型 |
| content | longtext | 日志内容 |
| username | varchar(191) | 用户名 |
| token_name | varchar(191) | 令牌名称 |
| token_id | bigint | 令牌ID |
| model_name | varchar(191) | 模型名称 |
| quota | bigint | 消耗额度 |
| prompt_tokens | bigint | 提示词 token 数 |
| completion_tokens | bigint | 完成 token 数 |
| use_time | bigint | 使用时长（毫秒） |
| is_stream | tinyint(1) | 是否流式输出 |
| channel_id | bigint | 渠道ID |
| channel_name | longtext | 渠道名称 |
| group | varchar(191) | 用户组 |
| ip | varchar(191) | 服务器IP |
| client_ip | varchar(191) | 客户端IP |
| request_id | varchar(64) | 请求ID |
| other | longtext | 其他信息 |

### 9. quota_data - 额度统计表
用户模型使用统计

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| username | varchar(64) | 用户名 |
| model_name | varchar(64) | 模型名称 |
| created_at | bigint | 创建时间 |
| token_used | bigint | 使用的 token 数 |
| count | bigint | 请求次数 |
| quota | bigint | 消耗额度 |

---

## 订阅与支付表

### 10. subscription_plans - 订阅计划表
订阅套餐配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| title | varchar(128) | 套餐标题 |
| subtitle | varchar(255) | 副标题 |
| price_amount | decimal(10,6) | 价格 |
| currency | varchar(8) | 货币（默认 USD） |
| duration_unit | varchar(16) | 时长单位（默认 month） |
| duration_value | bigint | 时长数值（默认 1） |
| custom_seconds | bigint | 自定义秒数 |
| total_amount | bigint | 总额度 |
| quota_reset_period | varchar(16) | 额度重置周期（默认 never） |
| quota_reset_custom_seconds | bigint | 自定义重置秒数 |
| enabled | tinyint(1) | 是否启用 |
| sort_order | bigint | 排序 |
| stripe_price_id | varchar(128) | Stripe 价格ID |
| creem_product_id | varchar(128) | Creem 产品ID |
| max_purchase_per_user | bigint | 每用户最大购买次数 |
| upgrade_group | varchar(64) | 升级组 |
| created_at | bigint | 创建时间 |
| updated_at | bigint | 更新时间 |

### 11. user_subscriptions - 用户订阅表
用户订阅记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| plan_id | bigint | 计划ID |
| amount_total | bigint | 总额度 |
| amount_used | bigint | 已使用额度 |
| start_time | bigint | 开始时间 |
| end_time | bigint | 结束时间 |
| status | varchar(32) | 状态 |
| source | varchar(32) | 来源（默认 order） |
| last_reset_time | bigint | 上次重置时间 |
| next_reset_time | bigint | 下次重置时间 |
| upgrade_group | varchar(64) | 升级组 |
| prev_user_group | varchar(64) | 之前的用户组 |
| created_at | bigint | 创建时间 |
| updated_at | bigint | 更新时间 |

### 12. subscription_orders - 订阅订单表
订阅购买订单

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| plan_id | bigint | 计划ID |
| money | double | 金额 |
| trade_no | varchar(255) | 交易号，唯一 |
| payment_method | varchar(50) | 支付方式 |
| status | longtext | 状态 |
| create_time | bigint | 创建时间 |
| complete_time | bigint | 完成时间 |
| provider_payload | text | 支付提供商数据 |

### 13. subscription_pre_consume_records - 订阅预消费记录表
订阅额度预消费记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| request_id | varchar(64) | 请求ID，唯一 |
| user_id | bigint | 用户ID |
| user_subscription_id | bigint | 用户订阅ID |
| pre_consumed | bigint | 预消费额度 |
| status | varchar(32) | 状态 |
| created_at | bigint | 创建时间 |
| updated_at | bigint | 更新时间 |

### 14. top_ups - 充值记录表
用户充值订单

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| amount | bigint | 充值额度 |
| money | double | 充值金额 |
| trade_no | varchar(255) | 交易号，唯一 |
| payment_method | varchar(50) | 支付方式 |
| status | longtext | 状态 |
| create_time | bigint | 创建时间 |
| complete_time | bigint | 完成时间 |

### 15. redemption_logs - 兑换日志表
兑换码使用记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| redemption_id | bigint | 兑换码ID |
| user_id | bigint | 使用者用户ID |
| used_time | bigint | 使用时间 |

### 16. checkins - 签到记录表
用户每日签到记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| checkin_date | varchar(10) | 签到日期（YYYY-MM-DD） |
| quota_awarded | bigint | 奖励额度 |
| created_at | bigint | 创建时间 |

---

## 任务与AI服务表

### 17. tasks - 任务表
异步任务管理（如图像生成等）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| task_id | varchar(191) | 任务ID |
| platform | varchar(30) | 平台 |
| user_id | bigint | 用户ID |
| channel_id | bigint | 渠道ID |
| quota | bigint | 消耗额度 |
| action | varchar(40) | 操作类型 |
| status | varchar(20) | 状态 |
| fail_reason | longtext | 失败原因 |
| submit_time | bigint | 提交时间 |
| start_time | bigint | 开始时间 |
| finish_time | bigint | 完成时间 |
| progress | varchar(20) | 进度 |
| properties | json | 属性 |
| data | json | 数据 |
| private_data | json | 私有数据 |
| group | varchar(50) | 分组 |
| created_at | bigint | 创建时间 |
| updated_at | bigint | 更新时间 |

### 18. midjourneys - Midjourney 任务表
Midjourney 图像生成任务

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| code | bigint | 状态码 |
| user_id | bigint | 用户ID |
| channel_id | bigint | 渠道ID |
| mj_id | varchar(191) | Midjourney 任务ID |
| action | varchar(40) | 操作类型 |
| prompt | longtext | 提示词 |
| prompt_en | longtext | 英文提示词 |
| description | longtext | 描述 |
| state | longtext | 状态 |
| status | varchar(20) | 状态 |
| progress | varchar(30) | 进度 |
| fail_reason | longtext | 失败原因 |
| submit_time | bigint | 提交时间 |
| start_time | bigint | 开始时间 |
| finish_time | bigint | 完成时间 |
| image_url | longtext | 图片URL |
| video_url | longtext | 视频URL |
| video_urls | longtext | 视频URL列表 |
| buttons | longtext | 按钮 |
| properties | longtext | 属性 |
| quota | bigint | 消耗额度 |

---

## 认证与安全表

### 19. two_fas - 双因素认证表
用户双因素认证配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID，唯一 |
| secret | varchar(255) | 密钥 |
| is_enabled | tinyint(1) | 是否启用 |
| failed_attempts | bigint | 失败尝试次数 |
| locked_until | datetime(3) | 锁定到期时间 |
| last_used_at | datetime(3) | 最后使用时间 |
| created_at | datetime(3) | 创建时间 |
| updated_at | datetime(3) | 更新时间 |
| deleted_at | datetime(3) | 软删除时间 |

### 20. two_fa_backup_codes - 双因素备份码表
双因素认证备份码

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| code_hash | varchar(255) | 备份码哈希 |
| is_used | tinyint(1) | 是否已使用 |
| used_at | datetime(3) | 使用时间 |
| created_at | datetime(3) | 创建时间 |
| deleted_at | datetime(3) | 软删除时间 |

### 21. passkey_credentials - Passkey 凭证表
WebAuthn/Passkey 认证凭证

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID，唯一 |
| credential_id | varchar(512) | 凭证ID，唯一 |
| public_key | text | 公钥 |
| attestation_type | varchar(255) | 认证类型 |
| aa_guid | varchar(512) | 认证器GUID |
| sign_count | int unsigned | 签名计数 |
| clone_warning | tinyint(1) | 克隆警告 |
| user_present | tinyint(1) | 用户在场 |
| user_verified | tinyint(1) | 用户已验证 |
| backup_eligible | tinyint(1) | 可备份 |
| backup_state | tinyint(1) | 备份状态 |
| transports | text | 传输方式 |
| attachment | varchar(32) | 附件类型 |
| last_used_at | datetime(3) | 最后使用时间 |
| created_at | datetime(3) | 创建时间 |
| updated_at | datetime(3) | 更新时间 |
| deleted_at | datetime(3) | 软删除时间 |

### 22. custom_oauth_providers - 自定义 OAuth 提供商表
自定义 OAuth 登录配置

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| name | varchar(64) | 提供商名称 |
| slug | varchar(64) | 唯一标识，唯一 |
| icon | varchar(128) | 图标 |
| enabled | tinyint(1) | 是否启用 |
| client_id | varchar(256) | 客户端ID |
| client_secret | varchar(512) | 客户端密钥 |
| authorization_endpoint | varchar(512) | 授权端点 |
| token_endpoint | varchar(512) | 令牌端点 |
| user_info_endpoint | varchar(512) | 用户信息端点 |
| scopes | varchar(256) | 授权范围 |
| user_id_field | varchar(128) | 用户ID字段（默认 sub） |
| username_field | varchar(128) | 用户名字段 |
| display_name_field | varchar(128) | 显示名字段 |
| email_field | varchar(128) | 邮箱字段 |
| well_known | varchar(512) | Well-known 配置URL |
| auth_style | bigint | 认证风格 |
| access_policy | text | 访问策略 |
| access_denied_message | varchar(512) | 拒绝访问消息 |
| created_at | datetime(3) | 创建时间 |
| updated_at | datetime(3) | 更新时间 |

### 23. user_oauth_bindings - 用户 OAuth 绑定表
用户与 OAuth 提供商的绑定关系

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| provider_id | bigint | 提供商ID |
| provider_user_id | varchar(256) | 提供商用户ID |
| created_at | datetime(3) | 创建时间 |

---

## 系统配置表

### 24. options - 系统选项表
系统配置键值对存储

| 字段 | 类型 | 说明 |
|------|------|------|
| key | varchar(191) | 配置键，主键 |
| value | longtext | 配置值 |

### 25. setups - 系统初始化表
系统初始化版本记录

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint unsigned | 主键，自增 |
| version | varchar(50) | 版本号 |
| initialized_at | bigint | 初始化时间 |

### 26. messages - 系统消息表
系统公告和消息

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| title | longtext | 消息标题 |
| content | text | 消息内容 |
| format | varchar(191) | 格式（默认 markdown） |
| created_by | bigint | 创建者ID |
| created_at | datetime(3) | 创建时间 |
| updated_at | datetime(3) | 更新时间 |

### 27. user_messages - 用户消息关联表
用户与消息的阅读状态

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| user_id | bigint | 用户ID |
| message_id | bigint | 消息ID |
| read_at | datetime(3) | 阅读时间 |
| created_at | datetime(3) | 创建时间 |

### 28. prefill_groups - 预填充分组表
预定义的配置分组

| 字段 | 类型 | 说明 |
|------|------|------|
| id | bigint | 主键，自增 |
| name | varchar(64) | 分组名称，唯一 |
| type | varchar(32) | 分组类型 |
| items | json | 分组项目 |
| description | varchar(255) | 描述 |
| created_time | bigint | 创建时间 |
| updated_time | bigint | 更新时间 |
| deleted_at | datetime(3) | 软删除时间 |

---

## 开发建议

### 常用查询场景

1. **用户额度查询**
   - 表：`users`
   - 关键字段：`quota`, `used_quota`, `subscription_quota`

2. **API 请求日志分析**
   - 表：`logs`
   - 关键字段：`user_id`, `model_name`, `quota`, `created_at`, `channel_id`

3. **渠道管理**
   - 表：`channels`, `abilities`
   - 关键字段：`status`, `balance`, `models`, `group`

4. **令牌管理**
   - 表：`tokens`
   - 关键字段：`key`, `status`, `remain_quota`, `expired_time`

5. **订阅管理**
   - 表：`subscription_plans`, `user_subscriptions`, `subscription_orders`
   - 关键字段：`status`, `end_time`, `amount_total`, `amount_used`

### 索引说明

- 大部分表都有 `deleted_at` 字段用于软删除
- 时间字段多为 `bigint` 类型（Unix 时间戳）
- 部分表使用 `datetime(3)` 类型（毫秒精度）
- JSON 字段用于存储复杂配置和扩展数据

### 注意事项

1. **额度单位**：系统中的 quota 通常以最小单位存储
2. **时间戳**：混合使用 bigint（秒/毫秒）和 datetime(3)
3. **软删除**：查询时需要注意 `deleted_at IS NULL` 条件
4. **分组概念**：`group` 字段用于权限和资源隔离
5. **JSON 字段**：`channel_info`, `properties`, `data` 等需要解析

---

**文档生成时间**: 2026-05-08
**数据库版本**: MySQL 8.2
**NewAPI 位置**: /root/zhic
