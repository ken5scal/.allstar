package handler

import (
	"bytes"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestValidateCommandLoadsConfig(t *testing.T) {
	configPath := writeConfig(t, validConfigYAML())
	out := &bytes.Buffer{}
	errOut := &bytes.Buffer{}

	cmd := NewRootCommand(out, errOut)
	cmd.SetArgs([]string{"validate", "--config", configPath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute validate: %v", err)
	}
	if got := errOut.String(); !strings.Contains(got, `"msg":"configuration valid"`) {
		t.Fatalf("expected validation output, got %q", got)
	}
}

func TestRootCommandRequiresConfig(t *testing.T) {
	cmd := NewRootCommand(&bytes.Buffer{}, &bytes.Buffer{})
	cmd.SetArgs([]string{"validate"})

	if err := cmd.Execute(); err == nil {
		t.Fatal("expected missing config error")
	}
}

func TestTickRunID(t *testing.T) {
	configPath := writeConfig(t, validConfigYAML())
	out := &bytes.Buffer{}
	errOut := &bytes.Buffer{}

	cmd := NewRootCommand(out, errOut)
	cmd.SetArgs([]string{"tick", "--config", configPath})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute tick: %v", err)
	}

	logOutput := errOut.String()
	if !strings.Contains(logOutput, `"tick_run_id"`) {
		t.Fatalf("expected tick_run_id in JSON log, got %q", logOutput)
	}
	if !strings.Contains(logOutput, `"command":"tick"`) {
		t.Fatalf("expected command field in JSON log, got %q", logOutput)
	}
}

func TestRunCommandParsesTargets(t *testing.T) {
	configPath := writeConfig(t, validConfigYAML())
	out := &bytes.Buffer{}
	errOut := &bytes.Buffer{}

	cmd := NewRootCommand(out, errOut)
	cmd.SetArgs([]string{"run", "--config", configPath, "--targets", "collect-rss,summarize"})

	if err := cmd.Execute(); err != nil {
		t.Fatalf("execute run: %v", err)
	}
	if got := errOut.String(); !strings.Contains(got, `"targets":"collect-rss,summarize"`) {
		t.Fatalf("expected targets in log, got %q", got)
	}
}

func writeConfig(t *testing.T, body string) string {
	t.Helper()

	path := filepath.Join(t.TempDir(), "config.yaml")
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatalf("write config: %v", err)
	}
	return path
}

func validConfigYAML() string {
	return `version: 1
timezone: "Asia/Tokyo"
defaults:
  vault_path: "/tmp/vault"
  state:
    driver: "sqlite"
    dsn: "./state.db"
  auth:
    x_bearer_token_env: "X_BEARER_TOKEN"
    ai_api_key_env: "AI_API_KEY"
  alert:
    provider: "mock"
    slack_webhook_env: "SLACK_WEBHOOK_URL"
sources:
  x:
    provider: "mock"
`
}
