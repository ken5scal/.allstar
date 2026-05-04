package repository

import "testing"

func TestAlertMockSendError(t *testing.T) {
	alert := NewMockAlertClient()
	if err := alert.SendError(t.Context(), Alert{
		TickRunID: "tick-1",
		Failures: []AlertFailure{
			{TargetID: "job-1", ErrorSummary: "failed", RetryHint: "retry next tick"},
		},
	}); err != nil {
		t.Fatalf("SendError: %v", err)
	}
	if len(alert.SentEvents()) != 1 {
		t.Fatalf("events = %#v", alert.SentEvents())
	}
}

func TestSlackMockDoesNotUseNetwork(t *testing.T) {
	alert := NewMockAlertClient()
	if err := alert.SendError(t.Context(), Alert{TickRunID: "tick-1", Failures: []AlertFailure{{TargetID: "job-1", ErrorSummary: "offline"}}}); err != nil {
		t.Fatalf("SendError: %v", err)
	}
	if got := alert.SentEvents()[0].ErrorSummary; got != "offline" {
		t.Fatalf("summary = %q", got)
	}
}
