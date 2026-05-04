package model

import "time"

type JobRun struct {
	JobRunID  string
	TickRunID string
	JobID     string
	Status    string
	ExitCode  int
	StartedAt time.Time
	EndedAt   time.Time
	Error     string
}

type TickTarget struct {
	ID       string
	Schedule string
	Enabled  bool
	Kind     string
}

type ScheduledJob = TickTarget
