package service

import (
	"fmt"
	"testing"
)

func TestGeoLocationKey_SameCity(t *testing.T) {
	a := IPGeoInfo{Success: true, CountryCode: "CN", Region: "浙江", City: "杭州"}
	b := IPGeoInfo{Success: true, CountryCode: "CN", Region: "浙江", City: "杭州"}
	if geoLocationKey(a) == "" || geoLocationKey(a) != geoLocationKey(b) {
		t.Fatalf("same city should share key: %q vs %q", geoLocationKey(a), geoLocationKey(b))
	}
}

func TestGeoLocationKey_CrossCity(t *testing.T) {
	hz := IPGeoInfo{Success: true, CountryCode: "CN", Region: "浙江", City: "杭州"}
	sh := IPGeoInfo{Success: true, CountryCode: "CN", Region: "上海", City: "上海"}
	if geoLocationKey(hz) == geoLocationKey(sh) {
		t.Fatalf("cross city should differ: both %q", geoLocationKey(hz))
	}
}

func TestAnalyzeIPGeoFromSequence_CampusChurn(t *testing.T) {
	// 同城 12 个 IP 轮换：应计 same_city_switches，cross_city=0，unique_cities=1
	seq := []map[string]interface{}{}
	geo := map[string]IPGeoInfo{}
	base := int64(1_700_000_000)
	for i := 0; i < 12; i++ {
		ip := fmt.Sprintf("10.0.0.%d", i+1)
		seq = append(seq, map[string]interface{}{"ip": ip, "created_at": base + int64(i*120)})
		geo[ip] = IPGeoInfo{Success: true, CountryCode: "CN", Region: "浙江", City: "杭州", IP: ip}
	}

	got := analyzeIPGeoFromSequence(seq, geo, true)
	if toInt64(got["unique_cities"]) != 1 {
		t.Fatalf("unique_cities=%v want 1", got["unique_cities"])
	}
	if toInt64(got["cross_city_switches"]) != 0 {
		t.Fatalf("cross_city_switches=%v want 0", got["cross_city_switches"])
	}
	if toInt64(got["same_city_switches"]) < 10 {
		t.Fatalf("same_city_switches=%v want >=10", got["same_city_switches"])
	}
}

func TestAnalyzeIPGeoFromSequence_CrossCityJump(t *testing.T) {
	seq := []map[string]interface{}{
		{"ip": "1.1.1.1", "created_at": int64(1000)},
		{"ip": "1.1.1.1", "created_at": int64(1100)},
		{"ip": "2.2.2.2", "created_at": int64(1200)}, // +100s 跨城
		{"ip": "3.3.3.3", "created_at": int64(1300)}, // +100s 再跨城
	}
	geo := map[string]IPGeoInfo{
		"1.1.1.1": {Success: true, CountryCode: "CN", Region: "浙江", City: "杭州", IP: "1.1.1.1"},
		"2.2.2.2": {Success: true, CountryCode: "CN", Region: "上海", City: "上海", IP: "2.2.2.2"},
		"3.3.3.3": {Success: true, CountryCode: "CN", Region: "北京", City: "北京", IP: "3.3.3.3"},
	}
	got := analyzeIPGeoFromSequence(seq, geo, true)
	if toInt64(got["unique_cities"]) != 3 {
		t.Fatalf("unique_cities=%v want 3", got["unique_cities"])
	}
	if toInt64(got["cross_city_switches"]) != 2 {
		t.Fatalf("cross_city=%v want 2", got["cross_city_switches"])
	}
	if toInt64(got["rapid_cross_city_count"]) != 2 {
		t.Fatalf("rapid_cross=%v want 2", got["rapid_cross_city_count"])
	}
}

func TestAppendGeoAwareIPRiskFlags_CampusNotManyIPs(t *testing.T) {
	geo := map[string]interface{}{
		"geo_available":          true,
		"unique_cities":          int64(1),
		"unique_countries":       int64(1),
		"cross_city_switches":    int64(0),
		"rapid_cross_city_count": int64(0),
		"min_cross_city_interval": int64(0),
	}
	ipSwitch := map[string]interface{}{
		"avg_ip_duration":    float64(200),
		"rapid_switch_count": int64(5),
		"real_switch_count":  int64(15),
	}
	flags := appendGeoAwareIPRiskFlags(nil, 18, ipSwitch, geo)
	for _, f := range flags {
		if f == "MANY_IPS" || f == "GEO_JUMP" || f == "MANY_CITIES" || f == "CROSS_BORDER" {
			t.Fatalf("campus churn should not raise strong geo flags, got %v", flags)
		}
	}
}

func TestAppendGeoAwareIPRiskFlags_CrossCityRaises(t *testing.T) {
	geo := map[string]interface{}{
		"geo_available":           true,
		"unique_cities":           int64(3),
		"unique_countries":        int64(1),
		"cross_city_switches":     int64(4),
		"rapid_cross_city_count":  int64(3),
		"min_cross_city_interval": int64(60),
	}
	ipSwitch := map[string]interface{}{
		"avg_ip_duration":    float64(100),
		"rapid_switch_count": int64(4),
		"real_switch_count":  int64(4),
	}
	flags := appendGeoAwareIPRiskFlags(nil, 12, ipSwitch, geo)
	want := map[string]bool{"MANY_IPS": false, "MANY_CITIES": false, "GEO_JUMP": false, "IP_RAPID_SWITCH": false}
	for _, f := range flags {
		if _, ok := want[f]; ok {
			want[f] = true
		}
	}
	for k, ok := range want {
		if !ok {
			t.Fatalf("missing flag %s in %v", k, flags)
		}
	}
}

func TestAppendGeoAwareIPRiskFlags_FallbackWithoutGeo(t *testing.T) {
	geo := map[string]interface{}{"geo_available": false}
	ipSwitch := map[string]interface{}{
		"avg_ip_duration":    float64(20),
		"rapid_switch_count": int64(4),
		"real_switch_count":  int64(5),
	}
	flags := appendGeoAwareIPRiskFlags(nil, 15, ipSwitch, geo)
	hasMany, hasRapid, hasHop := false, false, false
	for _, f := range flags {
		switch f {
		case "MANY_IPS":
			hasMany = true
		case "IP_RAPID_SWITCH":
			hasRapid = true
		case "IP_HOPPING":
			hasHop = true
		}
	}
	if !hasMany || !hasRapid || !hasHop {
		t.Fatalf("without geo should fall back to legacy flags, got %v", flags)
	}
}

func TestEnrichSwitchDetailsWithGeo(t *testing.T) {
	details := []map[string]interface{}{
		{"from_ip": "1.1.1.1", "to_ip": "2.2.2.2", "interval": int64(50)},
	}
	geo := map[string]IPGeoInfo{
		"1.1.1.1": {Success: true, CountryCode: "CN", Region: "浙江", City: "杭州"},
		"2.2.2.2": {Success: true, CountryCode: "CN", Region: "上海", City: "上海"},
	}
	enrichSwitchDetailsWithGeo(details, geo)
	if details[0]["is_geo_jump"] != true {
		t.Fatalf("expected geo jump, got %#v", details[0])
	}
	if details[0]["from_city"] == "" || details[0]["to_city"] == "" {
		t.Fatalf("expected city labels, got %#v", details[0])
	}
}
