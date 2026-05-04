package model

import "time"

type JobRun struct {
	JobRunID  string
	TickRunID string
	JobID     string
	Status    string
	StartedAt time.Time
	EndedAt   time.Time
	Error     string
}
