package handler

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/gin-gonic/gin"
	"github.com/new-api-tools/backend/internal/service"
)

func installIPHandlerRouter(t *testing.T) *gin.Engine {
	t.Helper()
	gin.SetMode(gin.TestMode)
	restore := service.SetIPGeoServiceProviderForTesting(func() *service.IPGeoService {
		return &service.IPGeoService{}
	})
	t.Cleanup(restore)

	r := gin.New()
	api := r.Group("/api")
	RegisterIPMonitoringRoutes(api)
	return r
}

func TestGetIPGeoReturnsStableSnakeCaseResponse(t *testing.T) {
	r := installIPHandlerRouter(t)

	req := httptest.NewRequest(http.MethodGet, "/api/ip/geo/10.0.0.1", nil)
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Success bool                   `json:"success"`
		Data    map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Success {
		t.Fatalf("success false: %#v", body)
	}
	if body.Data["country_code"] != "LO" || body.Data["success"] != true {
		t.Fatalf("unexpected geo payload: %#v", body.Data)
	}
	if _, ok := body.Data["countryCode"]; ok {
		t.Fatalf("response should use snake_case, got camelCase key: %#v", body.Data)
	}
}

func TestGetIPGeoBatchDedupesAndCapsAtMaxLimit(t *testing.T) {
	r := installIPHandlerRouter(t)
	ips := make([]string, 0, maxIPLimit+2)
	ips = append(ips, "10.0.0.1", "10.0.0.1")
	for i := 0; i < maxIPLimit+1; i++ {
		ips = append(ips, fmt.Sprintf("10.1.%d.%d", i/255, i%255))
	}
	payload, _ := json.Marshal(map[string]interface{}{"ips": ips})

	req := httptest.NewRequest(http.MethodPost, "/api/ip/geo/batch", bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	rec := httptest.NewRecorder()
	r.ServeHTTP(rec, req)

	if rec.Code != http.StatusOK {
		t.Fatalf("status = %d, body = %s", rec.Code, rec.Body.String())
	}
	var body struct {
		Success bool                     `json:"success"`
		Data    []map[string]interface{} `json:"data"`
	}
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatalf("decode response: %v", err)
	}
	if !body.Success {
		t.Fatalf("success false: %#v", body)
	}
	if len(body.Data) != maxIPLimit {
		t.Fatalf("batch should cap at %d unique IPs, got %d", maxIPLimit, len(body.Data))
	}
	if body.Data[0]["ip"] != "10.0.0.1" {
		t.Fatalf("batch should preserve first unique order, first = %#v", body.Data[0])
	}
}
