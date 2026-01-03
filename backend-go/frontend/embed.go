package frontend

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"

	"github.com/gin-gonic/gin"
)

//go:embed all:dist
var FrontendFS embed.FS

// ServeFrontend 提供前端静态文件服务
func ServeFrontend(r *gin.Engine) {
	// 从嵌入的文件系统中提取 dist 子目录
	distFS, err := fs.Sub(FrontendFS, "dist")
	if err != nil {
		// 如果提取失败，返回错误页面
		r.GET("/", func(c *gin.Context) {
			c.Data(503, "text/html; charset=utf-8", []byte(getErrorPage()))
		})
		return
	}

	// 使用 Gin 的静态文件服务 - /assets 路由
	r.StaticFS("/assets", http.FS(distFS))

	// 根路径返回 index.html
	r.GET("/", func(c *gin.Context) {
		indexContent, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			c.Data(503, "text/html; charset=utf-8", []byte(getErrorPage()))
			return
		}
		c.Data(200, "text/html; charset=utf-8", indexContent)
	})

	// NoRoute 处理器 - 智能SPA支持
	r.NoRoute(func(c *gin.Context) {
		path := c.Request.URL.Path

		// API 路由优先处理 - 返回 JSON 格式的 404
		if isAPIPath(path) {
			c.JSON(http.StatusNotFound, gin.H{
				"error":   "API endpoint not found",
				"path":    path,
				"message": "请求的API端点不存在",
			})
			return
		}

		// 去掉开头的 /
		if len(path) > 0 && path[0] == '/' {
			path = path[1:]
		}

		// 尝试从嵌入的文件系统读取文件
		fileContent, err := fs.ReadFile(distFS, path)
		if err == nil {
			// 文件存在，根据扩展名设置正确的 Content-Type
			contentType := getContentType(path)
			c.Data(200, contentType, fileContent)
			return
		}

		// 文件不存在，返回 index.html (SPA 路由支持)
		indexContent, err := fs.ReadFile(distFS, "index.html")
		if err != nil {
			c.Data(503, "text/html; charset=utf-8", []byte(getErrorPage()))
			return
		}
		c.Data(200, "text/html; charset=utf-8", indexContent)
	})
}

// isAPIPath 检查路径是否为 API 端点
func isAPIPath(path string) bool {
	// API 路由前缀列表
	apiPrefixes := []string{
		"/api/",   // Web 管理界面 API
		"/health", // 健康检查
	}

	for _, prefix := range apiPrefixes {
		if strings.HasPrefix(path, prefix) {
			return true
		}
	}

	return false
}

// getContentType 根据文件扩展名返回 Content-Type
func getContentType(path string) string {
	if len(path) == 0 {
		return "text/html; charset=utf-8"
	}

	// 从路径末尾查找扩展名
	ext := ""
	for i := len(path) - 1; i >= 0 && path[i] != '/'; i-- {
		if path[i] == '.' {
			ext = path[i:]
			break
		}
	}

	switch ext {
	case ".html":
		return "text/html; charset=utf-8"
	case ".css":
		return "text/css; charset=utf-8"
	case ".js":
		return "application/javascript; charset=utf-8"
	case ".json":
		return "application/json; charset=utf-8"
	case ".png":
		return "image/png"
	case ".jpg", ".jpeg":
		return "image/jpeg"
	case ".gif":
		return "image/gif"
	case ".svg":
		return "image/svg+xml"
	case ".ico":
		return "image/x-icon"
	case ".woff":
		return "font/woff"
	case ".woff2":
		return "font/woff2"
	case ".ttf":
		return "font/ttf"
	case ".eot":
		return "application/vnd.ms-fontobject"
	default:
		return "application/octet-stream"
	}
}

// getErrorPage 获取错误页面
func getErrorPage() string {
	return `<!DOCTYPE html>
<html>
<head>
  <title>NewAPI Tools - 配置错误</title>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    body { font-family: system-ui; padding: 40px; background: #f5f5f5; }
    .error { max-width: 600px; margin: 0 auto; background: white; padding: 40px; border-radius: 8px; }
    h1 { color: #dc3545; }
    code { background: #f8f9fa; padding: 2px 6px; border-radius: 3px; }
    pre { background: #f8f9fa; padding: 16px; border-radius: 4px; overflow-x: auto; }
  </style>
</head>
<body>
  <div class="error">
    <h1>前端资源未找到</h1>
    <p>无法找到前端构建文件。请执行以下步骤：</p>
    <h3>构建前端</h3>
    <pre>cd frontend && pnpm install && pnpm run build</pre>
    <h3>复制到后端</h3>
    <pre>make embed-frontend</pre>
    <p>或者直接运行：</p>
    <pre>make run</pre>
  </div>
</body>
</html>`
}
