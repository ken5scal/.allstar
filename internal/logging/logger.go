package logging

import (
	"context"
	"io"
	"log/slog"
)

type contextKey struct{}

// NewJSONLogger returns a JSON slog logger suitable for launchd stdout/stderr capture.
func NewJSONLogger(w io.Writer, level slog.Leveler) *slog.Logger {
	return slog.New(slog.NewJSONHandler(w, &slog.HandlerOptions{Level: level}))
}

func WithRunID(logger *slog.Logger, tickRunID string) *slog.Logger {
	return logger.With("tick_run_id", tickRunID)
}

func WithLogger(ctx context.Context, logger *slog.Logger) context.Context {
	return context.WithValue(ctx, contextKey{}, logger)
}

func FromContext(ctx context.Context) *slog.Logger {
	if logger, ok := ctx.Value(contextKey{}).(*slog.Logger); ok && logger != nil {
		return logger
	}
	return slog.Default()
}
