package model

import "time"

type Checkpoint struct {
	SourceID  string
	Cursor    string
	UpdatedAt time.Time
}

type Record struct {
	RecordID      string
	SchemaVersion int
	Source        string
	SourceItemKey string
	ContentHash   string
	Status        string
	AIDrafted     bool
	Category      string
	Tags          []string
	Intent        []string
	Attachments   []Attachment
	Summary       string
	TickRunID     string
	JobRunID      string
	Title         string
	RawContent    string
	URL           string
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type Attachment struct {
	Name string `yaml:"name"`
	Path string `yaml:"path"`
}
