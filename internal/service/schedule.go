package service

import (
	"fmt"
	"strconv"
	"strings"
	"time"
)

type Clock interface {
	Now() time.Time
}

type SystemClock struct{}

func (SystemClock) Now() time.Time {
	return time.Now()
}

type fixedClock struct {
	now time.Time
}

func (c fixedClock) Now() time.Time {
	return c.now
}

type Schedule struct {
	minute cronField
	hour   cronField
}

func ParseSchedule(expr string) (Schedule, error) {
	fields := strings.Fields(expr)
	if len(fields) != 5 {
		return Schedule{}, fmt.Errorf("schedule must have 5 cron fields")
	}
	minute, err := parseCronField(fields[0], 0, 59)
	if err != nil {
		return Schedule{}, fmt.Errorf("parse minute field: %w", err)
	}
	hour, err := parseCronField(fields[1], 0, 23)
	if err != nil {
		return Schedule{}, fmt.Errorf("parse hour field: %w", err)
	}
	return Schedule{minute: minute, hour: hour}, nil
}

func (s Schedule) Due(lastRun, now time.Time) bool {
	slot := s.previousOrCurrentSlot(now)
	if slot.IsZero() {
		return false
	}
	return lastRun.IsZero() || lastRun.Before(slot)
}

func (s Schedule) previousOrCurrentSlot(now time.Time) time.Time {
	now = now.Truncate(time.Minute)
	for i := 0; i <= 24*60; i++ {
		candidate := now.Add(-time.Duration(i) * time.Minute)
		if s.minute.matches(candidate.Minute()) && s.hour.matches(candidate.Hour()) {
			return candidate
		}
	}
	return time.Time{}
}

type cronField struct {
	any    bool
	step   int
	values map[int]struct{}
}

func (f cronField) matches(value int) bool {
	if f.any {
		if f.step <= 1 {
			return true
		}
		return value%f.step == 0
	}
	_, ok := f.values[value]
	return ok
}

func parseCronField(raw string, min, max int) (cronField, error) {
	if raw == "*" {
		return cronField{any: true}, nil
	}
	if strings.HasPrefix(raw, "*/") {
		step, err := strconv.Atoi(strings.TrimPrefix(raw, "*/"))
		if err != nil || step <= 0 {
			return cronField{}, fmt.Errorf("invalid step %q", raw)
		}
		return cronField{any: true, step: step}, nil
	}
	values := map[int]struct{}{}
	for _, part := range strings.Split(raw, ",") {
		value, err := strconv.Atoi(part)
		if err != nil {
			return cronField{}, fmt.Errorf("invalid value %q", part)
		}
		if value < min || value > max {
			return cronField{}, fmt.Errorf("value %d outside range %d-%d", value, min, max)
		}
		values[value] = struct{}{}
	}
	return cronField{values: values}, nil
}
