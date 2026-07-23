package database

import "testing"

func TestClickHouseDialectHelpers(t *testing.T) {
	m := &Manager{IsCH: true}

	if got, want := m.QuoteIdentifier("group"), "`group`"; got != want {
		t.Fatalf("QuoteIdentifier() = %q, want %q", got, want)
	}
	if got, want := m.StringAggDistinct("l.ip"), "arrayStringConcat(arraySort(groupUniqArray(l.ip)), ',')"; got != want {
		t.Fatalf("StringAggDistinct() = %q, want %q", got, want)
	}
	if got, want := m.CountDistinctNonEmpty("l.ip"), "uniqExactIf(l.ip, length(l.ip) > 0)"; got != want {
		t.Fatalf("CountDistinctNonEmpty() = %q, want %q", got, want)
	}
}
