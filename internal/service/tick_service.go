package service

import (
	"context"
	"fmt"
	"time"
	"uuid"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/model"
	"github.com/ken5scal/obsflow/internal/repository"
)

type realClock struct{}

func (realClock) Now() time.Time { return time.Now().UTC() }

type JobExecutor func(ctx context.Context, job model.TickTarget) error

type TickService struct {
	state    repository.StateRepository
	clock    Clock
	executor JobExecutor
	alert    repository.AlertClient
}

type TickResult struct {
	TickRunID string
	Executed  []string
	Skipped   []string
	Failures  []TickFailure
	ExitCode  apperror.Code
}

type TickFailure struct {
	JobID string
	Code  apperror.Code
	Err   error
}

func NewTickService(state repository.StateRepository, clock Clock, executor JobExecutor) *TickService {
	if clock == nil {
		clock = realClock{}
	}
	return &TickService{
		state:    state,
		clock:    clock,
		executor: executor,
	}
}

func (s *TickService) WithAlert(alert repository.AlertClient) *TickService {
	s.alert = alert
	return s
}

func (s *TickService) Run(ctx context.Context, jobs []model.TickTarget) TickResult {
	result := TickResult{TickRunID: uuid.New().String()}
	now := s.clock.Now().UTC()
	if s.executor == nil {
		s.executor = func(context.Context, model.TickTarget) error { return nil }
	}

	for _, job := range jobs {
		if !job.Enabled {
			result.Skipped = append(result.Skipped, job.ID)
			continue
		}
		last, lastErr := s.state.LastJobRun(ctx, job.ID)
		if lastErr != nil && lastErr != repository.ErrNotFound {
			result.addFailure(job.ID, apperror.CodeExternalDependency, lastErr)
			continue
		}
		var lastRun time.Time
		if lastErr == nil {
			lastRun = last.StartedAt
		}
		schedule, err := ParseSchedule(job.Schedule)
		if err != nil {
			result.addFailure(job.ID, apperror.CodeConfig, err)
			continue
		}
		due := schedule.Due(lastRun, now)
		if !due {
			result.Skipped = append(result.Skipped, job.ID)
			continue
		}

		jobRun := model.JobRun{
			JobRunID:  uuid.New().String(),
			TickRunID: result.TickRunID,
			JobID:     job.ID,
			Status:    "success",
			StartedAt: now,
			EndedAt:   now,
		}
		if err := s.executor(ctx, job); err != nil {
			code := apperror.FromError(err)
			jobRun.Status = "failed"
			jobRun.Error = err.Error()
			result.addFailure(job.ID, code, err)
		} else {
			result.Executed = append(result.Executed, job.ID)
		}
		if err := s.state.SaveJobRun(ctx, jobRun); err != nil {
			result.addFailure(job.ID, apperror.CodeExternalDependency, fmt.Errorf("save job run: %w", err))
		}
	}
	if s.alert != nil && len(result.Failures) > 0 {
		if err := s.alert.SendError(ctx, repository.Alert{
			TickRunID: result.TickRunID,
			Failures:  dedupeFailures(result.Failures),
		}); err != nil {
			result.addFailure("alert", apperror.CodeExternalDependency, fmt.Errorf("send alert: %w", err))
		}
	}
	return result
}

func (r *TickResult) addFailure(jobID string, code apperror.Code, err error) {
	r.Failures = append(r.Failures, TickFailure{JobID: jobID, Code: code, Err: err})
	r.ExitCode = apperror.HighestPriority(r.ExitCode, code)
}

func dedupeFailures(failures []TickFailure) []repository.AlertFailure {
	seen := map[string]struct{}{}
	out := make([]repository.AlertFailure, 0, len(failures))
	for _, failure := range failures {
		summary := ""
		if failure.Err != nil {
			summary = failure.Err.Error()
		}
		key := summary
		if _, ok := seen[key]; ok {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, repository.AlertFailure{
			TargetID:     failure.JobID,
			ErrorSummary: summary,
		})
	}
	return out
}
