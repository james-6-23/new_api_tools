package service

import (
	"bufio"
	"compress/flate"
	"compress/gzip"
	"context"
	"crypto/tls"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"github.com/andybalholm/brotli"
	utls "github.com/refraction-networking/utls"
	"golang.org/x/net/http2"

	"github.com/new-api-tools/backend/internal/cache"
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

// LinuxDoLookupService provides linux.do username lookup via uTLS CF bypass.
type LinuxDoLookupService struct{}

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

// NewLinuxDoLookupService creates a new service.
func NewLinuxDoLookupService() *LinuxDoLookupService {
	return &LinuxDoLookupService{}
}

// LookupUsername looks up the linux.do username for a given user ID.
// It first checks Redis cache, then makes a uTLS request.
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

	// 2. Make uTLS request
	targetURL := fmt.Sprintf(ldCertURLTpl, linuxDoID)
	logger.L.Debug(fmt.Sprintf("[LinuxDoLookup] 请求: id=%s url=%s", linuxDoID, targetURL))

	code, body, _, err := s.makeRequest(targetURL, utls.HelloChrome_120)
	if err != nil {
		logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] 请求失败: id=%s err=%v", linuxDoID, err))
		return nil, &LookupError{
			ErrorType:  "network",
			Message:    "无法连接到 linux.do，请稍后重试",
			StatusCode: http.StatusBadGateway,
		}
	}

	// 3. Check rate limit
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

	// 4. Check CF block
	if code == 403 {
		logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] CF拦截: id=%s code=%d", linuxDoID, code))
		return nil, &LookupError{
			ErrorType:  "cf_blocked",
			Message:    "被 Cloudflare 拦截 (403)",
			StatusCode: http.StatusBadGateway,
		}
	}

	// 5. Check successful SVG response
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

	// 6. Unexpected response
	logger.L.Warn(fmt.Sprintf("[LinuxDoLookup] 异常响应: id=%s code=%d bodyLen=%d", linuxDoID, code, len(body)))
	return nil, &LookupError{
		ErrorType:  "unknown",
		Message:    fmt.Sprintf("获取用户信息失败 (HTTP %d)", code),
		StatusCode: http.StatusBadGateway,
	}
}

// makeRequest performs a CF-bypassed HTTP request using uTLS (direct connection, no proxy).
func (s *LinuxDoLookupService) makeRequest(targetURL string, clientHelloID utls.ClientHelloID) (code int, body string, respHeaders http.Header, err error) {
	parsed, err := url.Parse(targetURL)
	if err != nil {
		return 0, "", nil, err
	}

	host := parsed.Host
	if !strings.Contains(host, ":") {
		host += ":443"
	}
	serverName := parsed.Hostname()

	// 1. Direct TCP connection
	rawConn, err := net.DialTimeout("tcp", host, 15*time.Second)
	if err != nil {
		return 0, "", nil, fmt.Errorf("TCP 连接失败: %w", err)
	}

	// 2. uTLS handshake (Chrome fingerprint)
	tlsConn := utls.UClient(rawConn, &utls.Config{
		ServerName: serverName,
	}, clientHelloID)

	if err := tlsConn.Handshake(); err != nil {
		rawConn.Close()
		return 0, "", nil, fmt.Errorf("TLS 握手失败: %w", err)
	}
	defer tlsConn.Close()

	// 3. Check negotiated protocol
	negotiatedProto := tlsConn.ConnectionState().NegotiatedProtocol

	// Build browser-like headers
	headers := http.Header{
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
	}

	var resp *http.Response

	if negotiatedProto == "h2" {
		// HTTP/2
		h2Transport := &http2.Transport{
			DialTLS: func(network, addr string, cfg *tls.Config) (net.Conn, error) {
				return tlsConn, nil
			},
		}

		req, err := http.NewRequest("GET", targetURL, nil)
		if err != nil {
			return 0, "", nil, err
		}
		req.Header = headers

		resp, err = h2Transport.RoundTrip(req)
		if err != nil {
			return 0, "", nil, fmt.Errorf("H2 请求失败: %w", err)
		}
	} else {
		// HTTP/1.1
		path := parsed.RequestURI()
		reqStr := fmt.Sprintf("GET %s HTTP/1.1\r\n", path)
		reqStr += fmt.Sprintf("Host: %s\r\n", parsed.Host)
		for k, vs := range headers {
			for _, v := range vs {
				reqStr += fmt.Sprintf("%s: %s\r\n", k, v)
			}
		}
		reqStr += "Connection: close\r\n\r\n"

		if _, err = tlsConn.Write([]byte(reqStr)); err != nil {
			return 0, "", nil, fmt.Errorf("写请求失败: %w", err)
		}

		br := bufio.NewReader(tlsConn)
		resp, err = http.ReadResponse(br, nil)
		if err != nil {
			return 0, "", nil, fmt.Errorf("读响应失败: %w", err)
		}
	}
	defer resp.Body.Close()

	// 4. Decompress response body
	var reader io.Reader
	switch resp.Header.Get("Content-Encoding") {
	case "gzip":
		reader, err = gzip.NewReader(resp.Body)
		if err != nil {
			return resp.StatusCode, "", resp.Header, err
		}
	case "br":
		reader = brotli.NewReader(resp.Body)
	case "deflate":
		reader = flate.NewReader(resp.Body)
	default:
		reader = resp.Body
	}

	bodyBytes, err := io.ReadAll(reader)
	if err != nil {
		return resp.StatusCode, "", resp.Header, err
	}

	return resp.StatusCode, string(bodyBytes), resp.Header, nil
}
