package service

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/repository"
)

func TestOfflineTickSmoke(t *testing.T) {
	env := newOfflineSmokeEnv(t)
	result := env.pipeline.Run(t.Context())
	if result.ExitCode != apperror.CodeOK {
		t.Fatalf("exit code = %d failures=%s", result.ExitCode, formatFailures(result.Failures))
	}
	if result.Created != 3 {
		t.Fatalf("created = %d, want 3", result.Created)
	}
	notes, err := filepath.Glob(filepath.Join(env.vaultRoot, "*", "*.md"))
	if err != nil {
		t.Fatalf("glob notes: %v", err)
	}
	if len(notes) != 3 {
		t.Fatalf("notes = %#v", notes)
	}
	body := readSmokeFile(t, notes[0])
	if !strings.Contains(body, "## AI Summary") {
		t.Fatalf("AI Summary missing:\n%s", body)
	}
}

func TestOfflineTickSmokeReplayDoesNotDuplicateRecords(t *testing.T) {
	env := newOfflineSmokeEnv(t)
	first := env.pipeline.Run(t.Context())
	second := env.pipeline.Run(t.Context())
	if first.ExitCode != apperror.CodeOK || second.ExitCode != apperror.CodeOK {
		t.Fatalf("unexpected exit codes first=%d second=%d", first.ExitCode, second.ExitCode)
	}
	if first.Created != 3 {
		t.Fatalf("first created = %d, want 3", first.Created)
	}
	if second.Created != 0 {
		t.Fatalf("second created = %d, want replay idempotent 0", second.Created)
	}
	notes, err := filepath.Glob(filepath.Join(env.vaultRoot, "*", "*.md"))
	if err != nil {
		t.Fatalf("glob notes: %v", err)
	}
	if len(notes) != 3 {
		t.Fatalf("notes after replay = %#v", notes)
	}
}

func TestOfflineTickSmokeCatchUp(t *testing.T) {
	env := newOfflineSmokeEnv(t)
	result := env.pipeline.Run(t.Context())
	if result.Tick.ExitCode != apperror.CodeOK {
		t.Fatalf("tick exit = %d", result.Tick.ExitCode)
	}
	last, err := env.state.LastJobRun(t.Context(), "offline-collect")
	if err != nil {
		t.Fatalf("LastJobRun: %v", err)
	}
	if !last.StartedAt.Equal(env.now) {
		t.Fatalf("started_at = %s, want catch-up slot %s", last.StartedAt, env.now)
	}
}

func TestOfflineTickSmokeFailSoftAndAlert(t *testing.T) {
	env := newOfflineSmokeEnv(t)
	env.pipeline.BeforeItem = func(itemKey string) error {
		if itemKey == "fixture-guid-1" {
			return apperror.New(apperror.CodeProcessingFailure, errors.New("fixture item failed"))
		}
		return nil
	}
	result := env.pipeline.Run(t.Context())
	if result.ExitCode != apperror.CodeProcessingFailure {
		t.Fatalf("exit code = %d", result.ExitCode)
	}
	if result.Created != 2 {
		t.Fatalf("created = %d, want fail-soft to continue with 2", result.Created)
	}
	if len(env.alert.SentMessages()) != 1 {
		t.Fatalf("alerts = %#v", env.alert.SentMessages())
	}
}

func TestOfflineTickSmokeExitCodePriority(t *testing.T) {
	env := newOfflineSmokeEnv(t)
	env.pipeline.BeforeItem = func(itemKey string) error {
		if itemKey == "fixture-guid-1" {
			return apperror.New(apperror.CodeProcessingFailure, errors.New("processing failed"))
		}
		return apperror.New(apperror.CodeExternalDependency, errors.New("external failed"))
	}
	env.alert.Err = apperror.New(apperror.CodeConfig, errors.New("alert config failed"))
	result := env.pipeline.Run(t.Context())
	if result.ExitCode != apperror.CodeExternalDependency {
		t.Fatalf("exit code = %d, want external priority over processing and alert failure", result.ExitCode)
	}
}

type offlineSmokeEnv struct {
	now       time.Time
	vaultRoot string
	state     *repository.SQLiteStateRepository
	alert     *repository.MockAlertClient
	pipeline  *OfflinePipeline
}

func newOfflineSmokeEnv(t *testing.T) offlineSmokeEnv {
	t.Helper()
	root := t.TempDir()
	state, err := repository.NewSQLiteStateRepository(t.Context(), filepath.Join(root, "state.db"))
	if err != nil {
		t.Fatalf("NewSQLiteStateRepository: %v", err)
	}
	t.Cleanup(func() {
		if err := state.Close(); err != nil {
			t.Fatalf("Close state: %v", err)
		}
	})
	vault, err := repository.NewFSVaultRepository(filepath.Join(root, "vault"))
	if err != nil {
		t.Fatalf("NewFSVaultRepository: %v", err)
	}
	rss := repository.NewRSSClient(nil)
	x := repository.NewXMockClient(
		filepath.Join("..", "..", "testdata", "x", "search.json"),
		"",
		"",
	)
	alert := repository.NewMockAlertClient()
	now := time.Date(2026, 5, 4, 12, 0, 0, 0, time.UTC)
	pipeline := &OfflinePipeline{
		State:   state,
		Vault:   vault,
		RSS:     rss,
		X:       x,
		AI:      repository.NewMockAIClient(),
		Alert:   alert,
		Now:     now,
		RSSPath: filepath.Join("..", "..", "testdata", "rss", "hn.xml"),
	}
	return offlineSmokeEnv{
		now:       now,
		vaultRoot: filepath.Join(root, "vault"),
		state:     state,
		alert:     alert,
		pipeline:  pipeline,
	}
}

func readSmokeFile(t *testing.T, path string) string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read smoke file: %v", err)
	}
	return string(data)
}

func formatFailures(failures []TickFailure) string {
	out := make([]string, 0, len(failures))
	for _, failure := range failures {
		out = append(out, fmt.Sprintf("%s:%v", failure.JobID, failure.Err))
	}
	return strings.Join(out, "; ")
}
