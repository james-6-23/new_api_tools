package service

import (
	"context"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strconv"
	"strings"
	"time"

	fhttp "github.com/bogdanfinn/fhttp"
	tls_client "github.com/bogdanfinn/tls-client"
	"github.com/bogdanfinn/tls-client/profiles"

	"github.com/new-api-tools/backend/internal/cache"
	"github.com/new-api-tools/backend/internal/config"
	"github.com/new-api-tools/backend/internal/logger"
)

// LookupResult holds the result of a linux.do username lookup.
type LookupResult struct {
	LinuxDoID  string `json:"linux_do_id"`
	Username   string `json:"username"`
	ProfileURL string `json:"profile_url"`
	FromCache  bool   `json:"from_cache"`
}

// LookupError represents a structured error with optional rate limit info.
type LookupError struct {
	ErrorType   string `json:"error_type"` // "rate_limit", "cf_blocked", "network", "not_found"
	Message     string `json:"message"`
	WaitSeconds int    `json:"wait_seconds,omitempty"`
	StatusCode  int    `json:"-"`
}

func (e *LookupError) Error() string {
	return e.Message
}

// LinuxDoLookupService provides linux.do username lookup via TLS fingerprint bypass.
type LinuxDoLookupService struct {
	client tls_client.HttpClient
}

var (
	ldUsernameRe    = regexp.MustCompile(`font-size="34\.8841px"[^>]*>\s*(.+?)\s*</text>`)
	ldRateLimitRe   = regexp.MustCompile(`"error_type"\s*:\s*"rate_limit"`)
	ldWaitSecondsRe = regexp.MustCompile(`"wait_seconds"\s*:\s*(\d+)`)
)

const (
	ldCachePrefix = "linuxdo:username:"
	ldCacheTTL    = 24 * time.Hour
	ldCertURLTpl  = "https://linux.do/discobot/certificate.svg?date=Jan+29+2024&type=advanced&user_id=%s"
)

// NewLinuxDoLookupService creates a new service with Chrome TLS fingerprint.
// If LINUXDO_PROXY_URL is set (e.g. socks5://user:pass@host:port), the request
// will be routed through that proxy to bypass Cloudflare IP reputation checks.
func NewLinuxDoLookupService() *LinuxDoLookupService {
	options := []tls_client.HttpClientOption{
		tls_client.WithTimeoutSeconds(30),
		tls_client.WithClientProfile(profiles.Chrome_120),
		tls_client.WithNotFollowRedirects(),
		tls_client.WithCookieJar(tls_client.NewCookieJar()),
	}

	if cfg := config.Get(); cfg != nil && cfg.LinuxDoProxyURL != "" {
		options = append(options, tls_client.WithProxyUrl(cfg.LinuxDoProxyURL))
		logger.L.Info(fmt.Sprintf("[LinuxDoLookup] 使用代理: %s", cfg.LinuxDoProxyURL))
	}

	client, err := tls_client.NewHttpClient(tls_client.NewNoopLogger(), options...)
	if err != nil {
		logger.L.Error(fmt.Sprintf("[LinuxDoLookup] 创建 TLS client 失败: %v", err))
		// Fallback: will fail on first request
		return &LinuxDoLookupService{}
	}

	return &LinuxDoLookupService{client: client}
}

// LookupUsername looks up the linux.do username for a given user ID.
func (s *LinuxDoLookupService) LookupUsername(linuxDoID string) (*LookupResult, *LookupError) {
	// 1. Check Redis cache
	cacheKey := ldCachePrefix + linuxDoID
	if cm := cache.Get(); cm != nil {
		ctx := context.Background()
		if cached, err := cm.RedisClient().Get(ctx, cacheKey).Result(); err == nil && cached != "" {
			logger.L.Debug(fmt.Sprintf("[LinuxDoLookup] 缓存命中: id=%s → %s", linuxDoID, cached))
			return &LookupResult{
				LinuxDoID:  linuxDoID,
				Username:   cached,
				ProfileURL: fmt.Sprintf("https://linux.do/u/%s/summary", cached),
				FromCache:  true,
			}, nil
		}
	}

	// 2. Check client
	if s.client == nil {
		return nil, &LookupError{
			ErrorType:  "config",
			Message:    "TLS client 未初始化",
			StatusCode: http.StatusServiceUnavailable,
		}
	}

	// 3. Make request with Chrome TLS fingerprint
	targetURL := fmt.Sprintf(ldCertURLTpl, linuxDoID)
	logger.L.Debug(fmt.Sprintf("[LinuxDoLookup] 请求: id=%s url=%s", linuxDoID, targetURL))

	req, err := fhttp.NewRequest(fhttp.MethodGet, targetURL, nil)
	if err != nil {
		return nil, &LookupError{
			ErrorType:  "network",
			Message:    "创建请求失败",
			StatusCode: http.StatusInternalServerError,
		}
	}

	req.Header = fhttp.Header{
		"User-Agent":                {"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"},
		"Accept":                    {"text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8"},
		"Accept-Language":           {"en-US,en;q=0.9,zh-CN;q=0.8,zh;q=0.7"},
		"Accept-Encoding":           {"gzip, deflate, br"},
		"Sec-Ch-Ua":                 {`"Chromium";v="122", "Not(A:Brand";v="24", "Google Chrome";v="122"`},
		"Sec-Ch-Ua-Mobile":          {"?0"},
		"Sec-Ch-Ua-Platform":        {`"Windows"`},
		"Sec-Fetch-Dest":            {"document"},
		"Sec-Fetch-Mode":            {"navigate"},
		"Sec-Fetch-Site":            {"none"},
		"Sec-Fetch-User":            {"?1"},
		"Upgrade-Insecure-Requests": {"1"},
		fhttp.HeaderOrderKey: {
			"user-agent", "accept", "accept-language", "accept-encoding",
			"sec-ch-ua", "sec-ch-ua-mobile", "sec-ch-ua-platform",
			"sec-fetch-dest", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-user",
			"upgrade-insecure-requests",
		},
	}

	resp, err := s.client.Do(req)
	if err != nil {
		logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] 请求失败: id=%s err=%v", linuxDoID, err))
		return nil, &LookupError{
			ErrorType:  "network",
			Message:    "无法连接到 linux.do，请稍后重试",
			StatusCode: http.StatusBadGateway,
		}
	}
	defer resp.Body.Close()

	bodyBytes, err := io.ReadAll(resp.Body)
	if err != nil {
		return nil, &LookupError{
			ErrorType:  "network",
			Message:    "读取响应失败",
			StatusCode: http.StatusBadGateway,
		}
	}
	body := string(bodyBytes)
	code := resp.StatusCode

	// 4. Check rate limit
	if ldRateLimitRe.MatchString(body) {
		waitSeconds := 0
		if match := ldWaitSecondsRe.FindStringSubmatch(body); len(match) >= 2 {
			waitSeconds, _ = strconv.Atoi(match[1])
		}
		logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] 限速: id=%s wait=%d", linuxDoID, waitSeconds))
		return nil, &LookupError{
			ErrorType:   "rate_limit",
			Message:     fmt.Sprintf("请求被限速，请等待 %d 秒后重试", waitSeconds),
			WaitSeconds: waitSeconds,
			StatusCode:  http.StatusTooManyRequests,
		}
	}

	// 5. Check CF block
	if code == 403 {
		logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] CF拦截: id=%s code=%d", linuxDoID, code))
		return nil, &LookupError{
			ErrorType:  "cf_blocked",
			Message:    "被 Cloudflare 拦截 (403)",
			StatusCode: http.StatusBadGateway,
		}
	}

	// 6. Try to extract username from SVG (200 response)
	if code == 200 && strings.Contains(strings.ToLower(body), "<svg") {
		match := ldUsernameRe.FindStringSubmatch(body)
		if len(match) >= 2 {
			username := strings.TrimSpace(match[1])
			logger.L.Info(fmt.Sprintf("[LinuxDoLookup] 成功: id=%s → %s", linuxDoID, username))

			// Cache the result
			if cm := cache.Get(); cm != nil {
				ctx := context.Background()
				cm.RedisClient().Set(ctx, cacheKey, username, ldCacheTTL)
			}

			return &LookupResult{
				LinuxDoID:  linuxDoID,
				Username:   username,
				ProfileURL: fmt.Sprintf("https://linux.do/u/%s/summary", username),
				FromCache:  false,
			}, nil
		}

		// SVG found but no username match
		logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] SVG无用户名: id=%s bodyLen=%d", linuxDoID, len(body)))
		return nil, &LookupError{
			ErrorType:  "not_found",
			Message:    "证书中未找到用户名",
			StatusCode: http.StatusNotFound,
		}
	}

	// 7. 404 = user has no certificate
	if code == 404 {
		logger.L.Info(fmt.Sprintf("[LinuxDoLookup] 用户无证书: id=%s", linuxDoID))
		return nil, &LookupError{
			ErrorType:  "not_found",
			Message:    "该用户没有 Linux.do 证书，无法获取用户名",
			StatusCode: http.StatusNotFound,
		}
	}

	// 8. Unexpected response
	logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] 异常响应: id=%s code=%d bodyLen=%d", linuxDoID, code, len(body)))
	return nil, &LookupError{
		ErrorType:  "unknown",
		Message:    fmt.Sprintf("获取用户信息失败 (HTTP %d)", code),
		StatusCode: http.StatusBadGateway,
	}
}
