package logging

import (
	"bytes"
	"encoding/json"
	"log/slog"
	"testing"
)

func TestJSONLoggerIncludesTickRunID(t *testing.T) {
	var out bytes.Buffer
	logger := WithRunID(NewJSONLogger(&out, slog.LevelInfo), "tick-123")

	logger.Info("hello", slog.String("component", "test"))

	var event map[string]any
	if err := json.Unmarshal(out.Bytes(), &event); err != nil {
		t.Fatalf("log output is not JSON: %v", err)
	}
	if event["tick_run_id"] != "tick-123" {
		t.Fatalf("tick_run_id = %v, want tick-123", event["tick_run_id"])
	}
	if event["component"] != "test" {
		t.Fatalf("component = %v, want test", event["component"])
	}
}
