package handler

import (
	"fmt"
	"log/slog"
	"uuid"

	"github.com/spf13/cobra"

	"github.com/ken5scal/obsflow/internal/apperror"
	"github.com/ken5scal/obsflow/internal/config"
	"github.com/ken5scal/obsflow/internal/logging"
)

func newTickCommand(opts *rootOptions) *cobra.Command {
	return &cobra.Command{
		Use:   "tick",
		Short: "Run due obsflow jobs once",
		RunE: func(cmd *cobra.Command, args []string) error {
			runID := uuid.New().String()
			logger := logging.WithRunID(logging.NewJSONLogger(cmd.ErrOrStderr(), slog.LevelInfo), runID)

			cfg, err := config.LoadFile(cmd.Context(), opts.configPath)
			if err != nil {
				logger.ErrorContext(cmd.Context(), "failed to load config", slog.String("command", "tick"), slog.String("error", err.Error()))
				return apperror.New(apperror.CodeConfig, err)
			}

			logger.InfoContext(
				cmd.Context(),
				"tick completed",
				slog.String("command", "tick"),
				slog.Int("rss_sources", len(cfg.Sources.RSS)),
				slog.Int("jobs", len(cfg.Jobs)),
			)
			_, _ = fmt.Fprintln(cmd.OutOrStdout(), "tick ok")
			return nil
		},
	}
}
