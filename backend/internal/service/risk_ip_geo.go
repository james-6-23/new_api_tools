package service

import (
	"fmt"
	"sort"
)

// geoLocationKey 用「国家|省|市」构造同地键；缺市时回落省/国家。
// 同城校园网/运营商换号应得到相同 key，跨城则不同。
func geoLocationKey(info IPGeoInfo) string {
	if !info.Success {
		return ""
	}
	if info.City != "" {
		return info.CountryCode + "|" + info.Region + "|" + info.City
	}
	if info.Region != "" {
		return info.CountryCode + "|" + info.Region + "|"
	}
	if info.CountryCode != "" {
		return info.CountryCode + "||"
	}
	if info.Country != "" {
		return info.Country + "||"
	}
	return ""
}

func geoDisplayLabel(info IPGeoInfo) string {
	if !info.Success {
		return ""
	}
	if info.City != "" {
		if info.Region != "" && info.Region != info.City {
			return info.Region + " · " + info.City
		}
		return info.City
	}
	if info.Region != "" {
		return info.Region
	}
	if info.Country != "" {
		return info.Country
	}
	return info.CountryCode
}

// collectDistinctIPs 从时序日志行中提取去重 IP（保持首次出现顺序）。
func collectDistinctIPs(ipSequence []map[string]interface{}) []string {
	seen := make(map[string]struct{}, len(ipSequence))
	out := make([]string, 0, 16)
	for _, row := range ipSequence {
		ip := fmt.Sprintf("%v", row["ip"])
		if ip == "" || ip == "<nil>" {
			continue
		}
		if _, ok := seen[ip]; ok {
			continue
		}
		seen[ip] = struct{}{}
		out = append(out, ip)
	}
	return out
}

// analyzeIPGeoFromSequence 基于时序 IP + Geo 查询结果做「同城 vs 跨城」统计。
// geoMap 由 LookupIPGeoBatch 提供；不可用时仍返回结构，available=false。
func analyzeIPGeoFromSequence(ipSequence []map[string]interface{}, geoMap map[string]IPGeoInfo, geoAvailable bool) map[string]interface{} {
	result := map[string]interface{}{
		"geo_available":            geoAvailable,
		"unique_cities":            int64(0),
		"unique_regions":           int64(0),
		"unique_countries":         int64(0),
		"cross_city_switches":      int64(0),
		"same_city_switches":       int64(0),
		"rapid_cross_city_count":   int64(0),
		"unknown_geo_ips":          int64(0),
		"min_cross_city_interval":  int64(0),
		"locations":                []map[string]interface{}{},
	}
	if len(ipSequence) == 0 {
		return result
	}

	citySet := map[string]struct{}{}
	regionSet := map[string]struct{}{}
	countrySet := map[string]struct{}{}
	var unknownIPs int64
	locHit := map[string]map[string]interface{}{} // key -> {label, country, region, city, ip_count}

	var (
		prevIP      string
		prevTime    int64
		prevKey     string
		prevKnown   bool
		crossCity   int64
		sameCity    int64
		rapidCross  int64
		minCross    int64
		minCrossSet bool
	)

	for _, row := range ipSequence {
		ip := fmt.Sprintf("%v", row["ip"])
		ts := toInt64(row["created_at"])
		if ip == "" || ip == "<nil>" || ts == 0 {
			continue
		}

		info, ok := geoMap[ip]
		if !ok {
			info = IPGeoInfo{IP: ip}
		}
		key := geoLocationKey(info)
		known := key != ""
		if !known {
			unknownIPs++
		} else {
			citySet[key] = struct{}{}
			if info.Region != "" {
				regionSet[info.CountryCode+"|"+info.Region] = struct{}{}
			}
			if info.CountryCode != "" {
				countrySet[info.CountryCode] = struct{}{}
			} else if info.Country != "" {
				countrySet[info.Country] = struct{}{}
			}
			if _, exists := locHit[key]; !exists {
				locHit[key] = map[string]interface{}{
					"key":          key,
					"label":        geoDisplayLabel(info),
					"country":      info.Country,
					"country_code": info.CountryCode,
					"region":       info.Region,
					"city":         info.City,
					"ip_count":     int64(0),
					"ips":          []string{},
				}
			}
			// 按 IP 去重计数在后面二次 pass；此处先记出现
		}

		if prevIP == "" {
			prevIP, prevTime, prevKey, prevKnown = ip, ts, key, known
			continue
		}
		if ip == prevIP {
			prevTime = ts
			continue
		}

		// IP 字符串变化
		interval := ts - prevTime
		bothKnown := known && prevKnown
		if bothKnown {
			if key == prevKey {
				sameCity++
			} else {
				crossCity++
				if interval <= 300 {
					rapidCross++
				}
				if !minCrossSet || interval < minCross {
					minCross = interval
					minCrossSet = true
				}
			}
		}
		// 未知 geo 的切换不计入同城/跨城（避免误伤）

		prevIP, prevTime, prevKey, prevKnown = ip, ts, key, known
	}

	// 每个 location 下有多少 distinct IP
	ipToKey := map[string]string{}
	for ip, info := range geoMap {
		k := geoLocationKey(info)
		if k == "" {
			continue
		}
		ipToKey[ip] = k
	}
	ipsPerLoc := map[string]map[string]struct{}{}
	for _, ip := range collectDistinctIPs(ipSequence) {
		k, ok := ipToKey[ip]
		if !ok {
			continue
		}
		if ipsPerLoc[k] == nil {
			ipsPerLoc[k] = map[string]struct{}{}
		}
		ipsPerLoc[k][ip] = struct{}{}
	}
	locations := make([]map[string]interface{}, 0, len(locHit))
	for k, loc := range locHit {
		ips := make([]string, 0, len(ipsPerLoc[k]))
		for ip := range ipsPerLoc[k] {
			ips = append(ips, ip)
		}
		sort.Strings(ips)
		loc["ip_count"] = int64(len(ips))
		loc["ips"] = ips
		locations = append(locations, loc)
	}
	sort.Slice(locations, func(i, j int) bool {
		return toInt64(locations[i]["ip_count"]) > toInt64(locations[j]["ip_count"])
	})

	result["unique_cities"] = int64(len(citySet))
	result["unique_regions"] = int64(len(regionSet))
	result["unique_countries"] = int64(len(countrySet))
	result["cross_city_switches"] = crossCity
	result["same_city_switches"] = sameCity
	result["rapid_cross_city_count"] = rapidCross
	result["unknown_geo_ips"] = unknownIPs
	if minCrossSet {
		result["min_cross_city_interval"] = minCross
	}
	result["locations"] = locations
	return result
}

// enrichSwitchDetailsWithGeo 给 IP 切换明细补上 from/to 城市标签与是否跨城。
func enrichSwitchDetailsWithGeo(switchDetails []map[string]interface{}, geoMap map[string]IPGeoInfo) {
	for _, d := range switchDetails {
		fromIP := fmt.Sprintf("%v", d["from_ip"])
		toIP := fmt.Sprintf("%v", d["to_ip"])
		fromInfo := geoMap[fromIP]
		toInfo := geoMap[toIP]
		fromKey := geoLocationKey(fromInfo)
		toKey := geoLocationKey(toInfo)
		d["from_city"] = geoDisplayLabel(fromInfo)
		d["to_city"] = geoDisplayLabel(toInfo)
		d["from_country"] = fromInfo.Country
		d["to_country"] = toInfo.Country
		d["from_country_code"] = fromInfo.CountryCode
		d["to_country_code"] = toInfo.CountryCode
		if fromKey != "" && toKey != "" {
			d["is_geo_jump"] = fromKey != toKey
			d["is_same_city"] = fromKey == toKey
		} else {
			d["is_geo_jump"] = false
			d["is_same_city"] = false
		}
	}
}

// appendGeoAwareIPRiskFlags 在已有 flags 上叠加 / 调整 IP 相关标记。
// 设计原则：同城 IP 抖动不进强风控；跨城/跨境才升权。
func appendGeoAwareIPRiskFlags(
	flags []string,
	uniqueIPs int64,
	ipSwitch map[string]interface{},
	geoAnalysis map[string]interface{},
) []string {
	geoAvailable, _ := geoAnalysis["geo_available"].(bool)
	uniqueCities := toInt64(geoAnalysis["unique_cities"])
	uniqueCountries := toInt64(geoAnalysis["unique_countries"])
	crossCity := toInt64(geoAnalysis["cross_city_switches"])
	rapidCross := toInt64(geoAnalysis["rapid_cross_city_count"])
	minCross := toInt64(geoAnalysis["min_cross_city_interval"])

	avgIPDuration := toFloat64(ipSwitch["avg_ip_duration"])
	rapidSwitchCount := toInt64(ipSwitch["rapid_switch_count"])
	realSwitchCount := toInt64(ipSwitch["real_switch_count"])

	// --- MANY_IPS：不再仅因「同城多 IP」触发 ---
	if uniqueIPs > 10 {
		if !geoAvailable {
			// Geo 不可用时回落旧行为，避免静默变软
			flags = append(flags, "MANY_IPS")
		} else if uniqueCities >= 2 {
			// 多城 + 多 IP：账号共享/代理更可疑
			flags = append(flags, "MANY_IPS")
		} else if uniqueIPs >= 40 {
			// 极端同城 churn 仍保留一道阈值（CGNAT 一般到不了这么夸张）
			flags = append(flags, "MANY_IPS")
		}
		// 同城 11–39 个 IP：不打 MANY_IPS（校园网/流量正常场景）
	}

	if geoAvailable {
		if uniqueCities >= 3 {
			flags = append(flags, "MANY_CITIES")
		}
		// 跨城切换：短时跨城或多次跨城
		if crossCity >= 2 || (crossCity >= 1 && minCross > 0 && minCross <= 300) {
			flags = append(flags, "GEO_JUMP")
		}
		if uniqueCountries >= 2 {
			flags = append(flags, "CROSS_BORDER")
		}

		// 快速切换 / 跳动：优先用「跨城快速」信号，避免同城换号误伤
		if rapidCross >= 3 && avgIPDuration < 300 {
			flags = append(flags, "IP_RAPID_SWITCH")
		} else if crossCity == 0 && rapidSwitchCount >= 8 && avgIPDuration < 60 {
			// 无跨城但极端快速换号（可能代理池同城节点）仍标
			flags = append(flags, "IP_RAPID_SWITCH")
		}

		if avgIPDuration < 30 && crossCity >= 3 {
			flags = append(flags, "IP_HOPPING")
		} else if avgIPDuration < 30 && crossCity == 0 && realSwitchCount >= 10 {
			flags = append(flags, "IP_HOPPING")
		}
	} else {
		// Geo 不可用：保持原阈值
		if rapidSwitchCount >= 3 && avgIPDuration < 300 {
			flags = append(flags, "IP_RAPID_SWITCH")
		}
		if avgIPDuration < 30 && realSwitchCount >= 3 {
			flags = append(flags, "IP_HOPPING")
		}
	}

	return flags
}
