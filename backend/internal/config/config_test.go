package config

import "testing"

func TestDetectLogEngine(t *testing.T) {
	tests := []struct {
		name string
		dsn  string
		want DatabaseEngine
	}{
		{name: "clickhouse", dsn: "clickhouse://default:secret@clickhouse:9000/new_api_logs", want: ClickHouse},
		{name: "postgres url", dsn: "postgresql://postgres:secret@postgres:5432/new-api", want: PostgreSQL},
		{name: "postgres keyword", dsn: "host=postgres user=postgres dbname=new-api", want: PostgreSQL},
		{name: "mysql", dsn: "root:secret@tcp(mysql:3306)/new-api", want: MySQL},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := detectLogEngine(tt.dsn); got != tt.want {
				t.Fatalf("detectLogEngine(%q) = %q, want %q", tt.dsn, got, tt.want)
			}
		})
	}
}

func TestClickHouseIsNotDetectedAsMainDatabase(t *testing.T) {
	if got := detectEngine("clickhouse://default:secret@clickhouse:9000/new_api_logs"); got == ClickHouse {
		t.Fatalf("detectEngine returned ClickHouse for the main database")
	}
}
