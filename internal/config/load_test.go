package config

import (
	"os"
	"path/filepath"
	"testing"
)

func TestLoadConfig(t *testing.T) {
	t.Setenv("SLACK_WEBHOOK_URL", "https://example.test/webhook")
	dir := t.TempDir()
	path := filepath.Join(dir, "config.yaml")
	if err := os.WriteFile(path, []byte(`
version: 1
timezone: Asia/Tokyo
defaults:
  vault_path: "/tmp/vault"
  state:
    driver: sqlite
    dsn: state.db
  auth:
    x_bearer_token_env: X_BEARER_TOKEN
    ai_api_key_env: AI_API_KEY
  alert:
    provider: mock
    slack_webhook_env: SLACK_WEBHOOK_URL
sources:
  rss:
    - id: hn
      enabled: true
      url: https://news.ycombinator.com/rss
      schedule: "*/30 * * * *"
  x:
    provider: mock
jobs:
  - id: summarize-main
    type: summarize
    enabled: true
    schedule: "*/15 * * * *"
`), 0o600); err != nil {
		t.Fatal(err)
	}

	cfg, err := Load(path)
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.Version != 1 {
		t.Fatalf("Version = %d, want 1", cfg.Version)
	}
	if got := cfg.Sources.X.Provider; got != "mock" {
		t.Fatalf("X provider = %q, want mock", got)
	}
}
