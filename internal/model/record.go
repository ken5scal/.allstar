package model

import "time"

type Checkpoint struct {
	SourceID  string
	Cursor    string
	UpdatedAt time.Time
}
