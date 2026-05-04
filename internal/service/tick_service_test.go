package service

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

func TestTickDueByLastJobRun(t *testing.T) {
	now := time.Date(2026, 5, 4, 3, 0, 0, 0, time.UTC)
	state := &fakeTickState{last: map[string]model.JobRun{
		"job-due": {JobID: "job-due", StartedAt: now.Add(-2 * time.Hour), Status: "success"},
	}}
	svc := NewTickService(state, fixedClock{now: now}, nil)

	result := svc.Run(t.Context(), []model.TickTarget{{ID: "job-due", Schedule: "0 * * * *", Enabled: true}})
	if len(result.Executed) != 1 || result.Executed[0] != "job-due" {
		t.Fatalf("executed result = %#v", result.Executed)
	}
}

func TestTickCatchUpRunsOneSlot(t *testing.T) {
	now := time.Date(2026, 5, 4, 10, 0, 0, 0, time.UTC)
	state := &fakeTickState{last: map[string]model.JobRun{
		"job-catchup": {JobID: "job-catchup", StartedAt: now.Add(-10 * time.Hour), Status: "success"},
	}}
	svc := NewTickService(state, fixedClock{now: now}, nil)

	result := svc.Run(t.Context(), []model.TickTarget{{ID: "job-catchup", Schedule: "0 * * * *", Enabled: true}})
	if len(result.Executed) != 1 {
		t.Fatalf("catch-up should run once, executed = %#v", result.Executed)
	}
	if got := state.saved["job-catchup"].StartedAt; !got.Equal(now) {
		t.Fatalf("started_at = %s, want %s", got, now)
	}
}

func TestTickSkipsNotDue(t *testing.T) {
	now := time.Date(2026, 5, 4, 3, 10, 0, 0, time.UTC)
	state := &fakeTickState{last: map[string]model.JobRun{
		"job-skip": {JobID: "job-skip", StartedAt: time.Date(2026, 5, 4, 3, 0, 0, 0, time.UTC), Status: "success"},
	}}
	svc := NewTickService(state, fixedClock{now: now}, nil)

	result := svc.Run(t.Context(), []model.TickTarget{{ID: "job-skip", Schedule: "0 * * * *", Enabled: true}})
	if len(result.Executed) != 0 {
		t.Fatalf("expected skip, executed = %#v", result.Executed)
	}
}

func TestFailSoftContinuesAfterTargetFailure(t *testing.T) {
	now := time.Date(2026, 5, 4, 3, 0, 0, 0, time.UTC)
	state := &fakeTickState{}
	calls := []string{}
	svc := NewTickService(state, fixedClock{now: now}, func(_ context.Context, job model.TickTarget) error {
		calls = append(calls, job.ID)
		if job.ID == "first" {
			return apperror.New(apperror.CodeProcessingFailure, errors.New("first failed"))
		}
		return nil
	})

	result := svc.Run(t.Context(), []model.TickTarget{
		{ID: "first", Schedule: "* * * * *", Enabled: true},
		{ID: "second", Schedule: "* * * * *", Enabled: true},
	})

	if len(calls) != 2 {
		t.Fatalf("fail-soft did not continue, calls = %#v", calls)
	}
	if result.ExitCode != apperror.CodeProcessingFailure {
		t.Fatalf("exit code = %d", result.ExitCode)
	}
	if len(result.Failures) != 1 {
		t.Fatalf("failures = %#v", result.Failures)
	}
}

func TestExitCodePriority1Over2Over3(t *testing.T) {
	got := apperror.HighestPriority(apperror.CodeProcessingFailure, apperror.CodeExternalDependency, apperror.CodeConfig)
	if got != apperror.CodeConfig {
		t.Fatalf("priority = %d", got)
	}
}

func TestExitCodePriority2Over3(t *testing.T) {
	got := apperror.HighestPriority(apperror.CodeProcessingFailure, apperror.CodeExternalDependency)
	if got != apperror.CodeExternalDependency {
		t.Fatalf("priority = %d", got)
	}
}

type fakeTickState struct {
	last  map[string]model.JobRun
	saved map[string]model.JobRun
	repository.StateRepository
}

func (s *fakeTickState) LastJobRun(_ context.Context, jobID string) (model.JobRun, error) {
	if s.last == nil {
		return model.JobRun{}, repository.ErrNotFound
	}
	run, ok := s.last[jobID]
	if !ok {
		return model.JobRun{}, repository.ErrNotFound
	}
	return run, nil
}

func (s *fakeTickState) SaveJobRun(_ context.Context, run model.JobRun) error {
	if s.saved == nil {
		s.saved = map[string]model.JobRun{}
	}
	s.saved[run.JobID] = run
	return nil
}
